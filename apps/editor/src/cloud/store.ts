// Online saving (SPEC section 8.3). Signed in, the diagram on screen is one of the person's online diagrams: every change
// is saved to it a second after the last one, with the version it was made to, so a save from another tab or computer in
// between is a conflict the person settles, never a silent overwrite. The browser's own autosave keeps working
// underneath, so a dropped connection loses nothing: the change is sent when the connection returns.
//
// What is kept in this browser about the online diagram (`archboard:online`): whose it is, which one, the version on
// screen and whether there are changes not yet online. Signing out forgets it all, and the autosave, and the history.
import { create } from 'zustand';
import { emptyDiagram, fromTemplate, parseDiagram, type Diagram } from '@archboard/engine';
import { AUTOSAVE_KEY, EMBED, clearAutosave, flushAutosave, useEditor } from '../state/store.ts';
import * as api from './api.ts';
import type { CloudUser, Doc, Row } from './api.ts';

export type Sync = 'saved' | 'saving' | 'offline' | 'conflict' | 'ended' | 'error';
export type Panel = null | 'list' | 'dev' | 'delete' | 'signout';

interface Binding { user: string; id: string | null; version: number; dirty: boolean }
const BIND_KEY = 'archboard:online';
const SAVE_MS = 1000;
const RETRY_MS = 10_000;

interface CloudState {
  /** checking: asking the server; off: no cloud service here; out: signed out; in: signed in. */
  status: 'checking' | 'off' | 'out' | 'in';
  user: CloudUser | null;
  providers: { id: string; name: string }[];
  dev: boolean;
  /** The online diagram on screen, or null when it is not online yet (it will be at the first change). */
  doc: { id: string; version: number } | null;
  sync: Sync;
  /** Why the last save failed, when it is not a conflict or a lost connection. */
  problem: string | null;
  /** The other copy, when the diagram changed somewhere else since this one was opened. */
  conflict: Doc | null;
  panel: Panel;
  rows: Row[] | null;
  max: number;
  listError: string | null;
}

export const useCloud = create<CloudState>()(() => ({
  status: EMBED.embed ? 'off' : 'checking',
  user: null, providers: [], dev: false,
  doc: null, sync: 'saved', problem: null, conflict: null,
  panel: null, rows: null, max: 0, listError: null,
}));

// What is kept in this browser -----------------------------------------------------------------------------------------

function readBinding(): Binding | null {
  try {
    const b = JSON.parse(localStorage.getItem(BIND_KEY) ?? 'null') as Binding | null;
    return b && typeof b.user === 'string' && typeof b.version === 'number' ? b : null;
  } catch { return null; }
}
function writeBinding(b: Binding | null) {
  try { if (b) localStorage.setItem(BIND_KEY, JSON.stringify(b)); else localStorage.removeItem(BIND_KEY); } catch { /* blocked */ }
}
function hadLocalWork(): boolean {
  try { return localStorage.getItem(AUTOSAVE_KEY) !== null; } catch { return false; }
}
let dirty = false;
function remember() {
  const s = useCloud.getState();
  if (s.status !== 'in' || !s.user) return;
  writeBinding({ user: s.user.id, id: s.doc?.id ?? null, version: s.doc?.version ?? 0, dirty });
}

// Showing a diagram without it counting as an edit ---------------------------------------------------------------------

let quiet = false;
function show(d: Diagram, keepHistory = false) {
  quiet = true;
  try {
    if (keepHistory) useEditor.getState().commit(d);
    else useEditor.getState().reset(d);
  } finally { quiet = false; }
}
const asDiagram = (doc: Doc): Diagram => {
  const r = parseDiagram(doc.diagram);
  return r.ok ? r.diagram : emptyDiagram(doc.title);
};

// Saving -----------------------------------------------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | null = null;
let again = false;

function schedule(ms = SAVE_MS) {
  clearTimeout(timer);
  timer = setTimeout(() => void push(), ms);
}

/** Send the diagram on screen. One request at a time; a change made meanwhile is sent right after. */
export function push(): Promise<void> {
  clearTimeout(timer);
  const s = useCloud.getState();
  if (s.status !== 'in' || s.sync === 'conflict' || !dirty) return inFlight ?? Promise.resolve();
  if (inFlight) { again = true; return inFlight; }
  inFlight = (async () => {
    const d = useEditor.getState().diagram;
    useCloud.setState({ sync: 'saving', problem: null });
    const doc = useCloud.getState().doc;
    if (!doc) {
      const r = await api.create(d);
      if (r.ok) {
        useCloud.setState({ doc: { id: r.data.id, version: r.data.version } });
        settled(d);
      } else failed(r);
    } else {
      const r = await api.save(doc.id, d, doc.version);
      if (r.ok) {
        useCloud.setState({ doc: { id: doc.id, version: r.data.version } });
        settled(d);
      } else if (r.status === 409 && r.error === 'conflict' && r.current) {
        useCloud.setState({ sync: 'conflict', conflict: r.current });
      } else if (r.status === 404) {
        // Deleted somewhere else: what is on screen becomes a new online diagram.
        useCloud.setState({ doc: null });
        again = true;
      } else failed(r);
    }
    remember();
  })().finally(() => {
    inFlight = null;
    if (again) { again = false; void push(); }
  });
  return inFlight;
}

function settled(d: Diagram) {
  if (useEditor.getState().diagram === d) dirty = false;
  clearTimeout(retry);
  useCloud.setState({ sync: dirty ? 'saving' : 'saved' });
  if (dirty) again = true;
}

function failed(r: Extract<api.Result<unknown>, { ok: false }>) {
  if (r.status === 0 || r.status === 429 || r.status >= 500) {
    useCloud.setState({ sync: 'offline' });
    clearTimeout(retry);
    retry = setTimeout(() => void push(), RETRY_MS);
  } else if (r.status === 401 && !readBinding()) {
    // Signed out in another tab (it removed the link): this tab follows, leaving nothing behind.
    signedOutElsewhere();
  } else if (r.status === 401) {
    // The session ended (signed out in another tab, or 30 days without a visit). The work stays on screen and in
    // this browser; signing in again as the same person sends it.
    useCloud.setState({ status: 'out', user: null, sync: 'ended' });
    useEditor.getState().setNotice({ kind: 'bad', title: 'You were signed out.', lines: ['Your changes are kept in this browser. Sign in again to save them online.'] });
  } else {
    useCloud.setState({ sync: 'error', problem: r.message });
  }
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { if (useCloud.getState().sync === 'offline') void push(); });

// Signing out (or deleting the account) in one tab signs out every tab of this browser: another tab still showing the
// person's diagram would otherwise write it back into this browser at its next edit, for the next person to find.
function signedOutElsewhere() {
  forget();
  useCloud.setState({ status: 'out', user: null, panel: null, sync: 'saved' });
  useEditor.getState().setNotice({ kind: 'ok', title: 'Signed out in another tab. Nothing of your work is left in this browser.' });
}
if (typeof window !== 'undefined' && !EMBED.embed) {
  window.addEventListener('storage', (e) => {
    if (e.key !== BIND_KEY && e.key !== null) return;
    const c = useCloud.getState();
    if (c.status !== 'in' || !c.user) return;
    const b = readBinding();
    if (!b || b.user !== c.user.id) signedOutElsewhere();
  });
}

// Every change to the diagram: New and Open start a new online diagram; an edit is saved a second later.
useEditor.subscribe((s, prev) => {
  if (s.diagram === prev.diagram || quiet || EMBED.embed) return;
  const c = useCloud.getState();
  if (c.status !== 'in') {
    // Signed out after a session ended: keep a note that there is work to send once signed in again.
    if (c.sync === 'ended') { const b = readBinding(); if (b) writeBinding({ ...b, dirty: true }); }
    return;
  }
  if (s.loads !== prev.loads) useCloud.setState({ doc: null, conflict: null, sync: 'saving' });
  dirty = true;
  remember();
  if (c.sync === 'conflict') return;
  // From the edit on, the chip says the change is on its way (Offline stays Offline until the connection returns).
  if (c.sync === 'saved' || c.sync === 'error') useCloud.setState({ sync: 'saving', problem: null });
  schedule();
});

// Starting up ----------------------------------------------------------------------------------------------------------

/** Ask the server who is signed in, then line up the diagram on screen with the online one. */
export async function start() {
  if (EMBED.embed) return;
  const params = new URLSearchParams(location.search);
  const result = params.get('signin');
  if (result) {
    params.delete('signin');
    history.replaceState(history.state, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  }
  const me = await api.me();
  if (!me) { useCloud.setState({ status: 'off' }); return; }
  useCloud.setState({ providers: me.providers, dev: me.dev });
  if (result === 'failed') useEditor.getState().setNotice({ kind: 'bad', title: 'Signing in did not finish.', lines: ['Try again. Your diagram is still here.'] });

  const b = readBinding();
  if (!me.user) {
    useCloud.setState({ status: 'out', user: null });
    // Someone signed out elsewhere, or the session ran out. Work already online is not left on this (maybe shared)
    // computer; work not yet online stays, and goes online when the same person signs in again.
    if (b && !b.dirty) forget();
    else if (b?.dirty) useCloud.setState({ sync: 'ended' });
    return;
  }
  useCloud.setState({ status: 'in', user: me.user, sync: 'saved' });
  if (result === 'ok') useEditor.getState().setNotice({ kind: 'ok', title: `Signed in as ${me.user.name}. Your diagrams are saved online.` });

  if (b && b.user !== me.user.id) {
    // Another person's work on this computer: never put it into this account.
    forget();
    await openLatest();
    return;
  }
  if (b?.id) {
    const r = await api.get(b.id);
    if (r.ok) {
      useCloud.setState({ doc: { id: b.id, version: r.data.version } });
      if (r.data.version === b.version) {
        dirty = b.dirty;
      } else if (b.dirty) {
        // Changed here while offline and somewhere else meanwhile: the person chooses.
        dirty = true;
        useCloud.setState({ doc: { id: b.id, version: b.version }, sync: 'conflict', conflict: r.data });
      } else {
        show(asDiagram(r.data));
        dirty = false;
      }
    } else if (r.status === 404) {
      dirty = true; // deleted elsewhere: what is here becomes a new online diagram
    } else {
      dirty = b.dirty;
      useCloud.setState({ doc: { id: b.id, version: b.version } });
      failed(r);
    }
  } else if (b?.dirty || hadLocalWork()) {
    // First sign-in here: the diagram already in this browser becomes a new online diagram, never dropped.
    dirty = true;
  } else {
    await openLatest();
  }
  remember();
  if (dirty) void push();
}

async function openLatest() {
  const r = await api.list();
  const top = r.ok ? r.data.diagrams[0] : undefined;
  if (top) await openOnline(top.id);
}

// Actions --------------------------------------------------------------------------------------------------------------

/** Open one of the person's online diagrams, after sending what is on screen. */
export async function openOnline(id: string): Promise<boolean> {
  await flush();
  if (dirty) {
    useEditor.getState().setNotice({ kind: 'bad', title: 'Your last changes are not online yet.', lines: ['Wait for the connection to come back, or use Save to keep a file, then open the other diagram.'] });
    return false;
  }
  const r = await api.get(id);
  if (!r.ok) {
    useEditor.getState().setNotice({ kind: 'bad', title: 'That diagram could not be opened.', lines: [r.message] });
    return false;
  }
  show(asDiagram(r.data));
  dirty = false;
  useCloud.setState({ doc: { id, version: r.data.version }, sync: 'saved', conflict: null, problem: null, panel: null });
  remember();
  return true;
}

/** Send any change not yet online, and wait for it. */
export async function flush() {
  if (dirty && useCloud.getState().sync !== 'conflict') await push();
  else if (inFlight) await inFlight;
}

export async function loadList() {
  useCloud.setState({ listError: null });
  const r = await api.list();
  if (r.ok) useCloud.setState({ rows: r.data.diagrams, max: r.data.max });
  else useCloud.setState({ listError: r.message });
}

export async function deleteOnline(id: string) {
  const r = await api.remove(id);
  if (!r.ok && r.status !== 404) { useCloud.setState({ listError: r.message }); return; }
  if (useCloud.getState().doc?.id === id) {
    // The diagram on screen was deleted: it stays on screen as a new diagram that is not online.
    useCloud.setState({ doc: null });
    dirty = false;
    remember();
  }
  await loadList();
}

/** Settle a conflict: keep the other copy (this one stays in Undo), keep this one, or keep both as two diagrams. */
export async function settle(choice: 'theirs' | 'mine' | 'both') {
  const c = useCloud.getState();
  const other = c.conflict, doc = c.doc;
  if (!other || !doc) return;
  if (choice === 'theirs') {
    show(asDiagram(other), true);
    dirty = false;
    useCloud.setState({ doc: { id: doc.id, version: other.version }, conflict: null, sync: 'saved' });
    remember();
    return;
  }
  if (choice === 'mine') {
    useCloud.setState({ doc: { id: doc.id, version: other.version }, conflict: null, sync: 'saving' });
  } else {
    // The other copy stays where it is; this one becomes a new online diagram named as a copy.
    useCloud.setState({ doc: null, conflict: null, sync: 'saving' });
    const d = useEditor.getState().diagram;
    show({ ...d, title: `${d.title} (copy)`.slice(0, 80) }, true);
  }
  dirty = true;
  remember();
  await push();
}

export function signIn(provider: string) {
  flushAutosave();
  location.assign(api.signInUrl(provider));
}

export async function devSignIn(name: string): Promise<string | null> {
  flushAutosave();
  const r = await api.devSignIn(name);
  if (!r.ok) return r.message;
  location.replace(`${location.pathname}?signin=ok`);
  return null;
}

/** Sign out. With changes not online yet, only when `anyway` (the person was asked). */
export async function signOut(anyway = false): Promise<boolean> {
  await flush();
  if (dirty && !anyway) { useCloud.setState({ panel: 'signout' }); return false; }
  await api.signOut();
  forget();
  useCloud.setState({ status: 'out', user: null, panel: null, sync: 'saved' });
  useEditor.getState().setNotice({ kind: 'ok', title: 'Signed out. Nothing of your work is left in this browser.' });
  return true;
}

export async function deleteAccount(): Promise<string | null> {
  const r = await api.deleteAccount();
  if (!r.ok) return r.message;
  forget();
  useCloud.setState({ status: 'out', user: null, panel: null, sync: 'saved' });
  useEditor.getState().setNotice({ kind: 'ok', title: 'Your account and all its diagrams are deleted.' });
  return null;
}

/** Leave nothing of the signed-in person in this browser: the link to their diagram, the autosave and the history. */
function forget() {
  clearTimeout(timer);
  clearTimeout(retry);
  dirty = false;
  writeBinding(null);
  show(fromTemplate('three-tier'));
  // After showing the template, so the editor's autosave does not write it back: no local work is left at all.
  clearAutosave();
  useCloud.setState({ doc: null, conflict: null, rows: null, problem: null });
}

/** For tests: start again. */
export function _reset() {
  clearTimeout(timer); clearTimeout(retry);
  dirty = false; inFlight = null; again = false; quiet = false;
}
