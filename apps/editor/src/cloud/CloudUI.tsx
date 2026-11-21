// The parts of the editor for accounts and online saving (SPEC section 8.3): the save status in the top bar, the account
// menu, and the dialogs (My diagrams, a test sign-in, a conflict, signing out with changes not online, deleting the
// account). None of it shows where there is no cloud service, or in an embed.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor } from '../state/store.ts';
import { Icon } from '../ui/Icon.tsx';
import { deleteAccount, deleteOnline, devSignIn, loadList, openOnline, settle, signIn, signOut, useCloud } from './store.ts';

/** Ask the top bar to open its file picker (the same one as Open when signed out). */
export const pickFile = () => window.dispatchEvent(new Event('archboard:open-file'));
export const openPanel = (panel: 'list' | 'dev' | 'delete' | 'conflict') => {
  if (panel === 'list') void loadList();
  useCloud.setState({ panel: panel === 'conflict' ? null : panel });
  if (panel === 'conflict') showConflict.set(true);
};
// The conflict dialog opens by itself when a conflict comes up; closing it leaves the chip to open it again.
const showConflict = { on: true, set(v: boolean) { this.on = v; window.dispatchEvent(new Event('archboard:conflict')); } };

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Where the work is kept, in one chip. Signed out (or no service): the browser's own autosave, as before. */
export function SaveChip() {
  const save = useEditor((s) => s.save);
  const status = useCloud((s) => s.status);
  const sync = useCloud((s) => s.sync);
  const problem = useCloud((s) => s.problem);
  if (status === 'in' || sync === 'ended') {
    if (sync === 'saved') return <span className="chip chip--ok" title="Every change is saved to your account"><Icon name="cloud" />Saved<span className="sr-only"> online</span></span>;
    if (sync === 'saving') return <span className="chip" title="Sending your last change"><Icon name="cloud" />Saving…</span>;
    if (sync === 'offline') return <span className="chip chip--warn" title="No connection: changes are kept in this browser and sent when the connection returns"><Icon name="cloud-off" />Offline</span>;
    if (sync === 'ended') return <span className="chip chip--warn" title="Sign in again to save your changes online; until then they stay in this browser"><Icon name="cloud-off" />Not online</span>;
    if (sync === 'conflict') return <button className="chip chip--bad chip-btn" type="button" title="This diagram changed somewhere else: choose which to keep" onClick={() => openPanel('conflict')}><Icon name="alert" />Conflict</button>;
    return <span className="chip chip--bad" title={problem ?? 'The last save failed'}><Icon name="alert" />Not saved</span>;
  }
  return save === 'saved'
    ? <span className="chip chip--ok" title="Every change is kept in this browser"><Icon name="check" />Saved</span>
    : <span className="chip chip--warn" title="This browser blocks storage: use Save to keep your work"><Icon name="alert" />Not saved</span>;
}

/** Sign in, or the signed-in person's menu. */
export function Account() {
  const status = useCloud((s) => s.status);
  const user = useCloud((s) => s.user);
  const providers = useCloud((s) => s.providers);
  const dev = useCloud((s) => s.dev);
  if (status === 'in' && user) {
    // A round badge with the person's initial; the menu itself is a real select laid over it (keyboard, screen readers).
    const initial = (user.name.match(/\p{L}|\p{N}/u)?.[0] ?? '?').toUpperCase();
    return (
      <span className="account" title={`Signed in as ${user.name}`}>
        <span className="account-badge" aria-hidden="true">{initial}</span>
        <select className="account-select" aria-label={`Account: ${user.name}`} value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'list' || v === 'delete') openPanel(v);
            else if (v === 'out') void signOut();
          }}>
          <option value="">Signed in as {user.name}</option>
          <option value="list">My diagrams</option>
          <option value="out">Sign out</option>
          <option value="delete">Delete account…</option>
        </select>
      </span>
    );
  }
  if (status !== 'out') return null;
  const ways = [...providers.map((p) => ({ id: p.id, label: `Sign in with ${p.name}` })), ...(dev ? [{ id: 'dev', label: 'Sign in with a test account' }] : [])];
  if (!ways.length) return null;
  const go = (id: string) => (id === 'dev' ? openPanel('dev') : signIn(id));
  if (ways.length === 1) {
    return <button className="btn btn--accent signin-btn" type="button" aria-label={ways[0]!.label} title={`${ways[0]!.label} to save your diagrams online`} onClick={() => go(ways[0]!.id)}><Icon name="person" /><span className="lbl">Sign in</span></button>;
  }
  return (
    <select className="input select signin-select" aria-label="Sign in to save online" value="" onChange={(e) => e.target.value && go(e.target.value)}>
      <option value="">Sign in</option>
      {ways.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
    </select>
  );
}

function Modal({ title, onClose, children, wide, alert }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; alert?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} className={`modal${wide ? ' modal--wide' : ''}`} role={alert ? 'alertdialog' : undefined} aria-labelledby="modal-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button className="btn btn--icon btn--ghost" type="button" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      </div>
      {children}
    </dialog>
  );
}

function MyDiagrams() {
  const rows = useCloud((s) => s.rows);
  const max = useCloud((s) => s.max);
  const current = useCloud((s) => s.doc?.id ?? null);
  const error = useCloud((s) => s.listError);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => useCloud.setState({ panel: null });
  return (
    <Modal title="My diagrams" onClose={close} wide>
      <div className="modal-bar">
        <span className="hint">{rows ? `${rows.length} of ${max} online` : 'Loading…'}</span>
        <button className="btn btn--sm" type="button" onClick={() => { close(); pickFile(); }}><Icon name="folder" />Open a file</button>
      </div>
      {error && <p className="modal-error" role="alert">{error}</p>}
      {rows && rows.length === 0 && <p className="modal-empty">No diagrams online yet. Change the diagram on screen and it is saved here.</p>}
      {rows && rows.length > 0 && (
        <ul className="doc-list" aria-label="Online diagrams">
          {rows.map((r) => (
            <li key={r.id} className={r.id === current ? 'is-current' : undefined}>
              {asking === r.id ? (
                <>
                  <span className="doc-name">Delete “{r.title}” for good?</span>
                  <span className="doc-actions">
                    <button className="btn btn--sm btn--danger" type="button" disabled={busy} onClick={async () => { setBusy(true); await deleteOnline(r.id); setBusy(false); setAsking(null); }}>Delete</button>
                    <button className="btn btn--sm" type="button" autoFocus onClick={() => setAsking(null)}>Keep it</button>
                  </span>
                </>
              ) : (
                <>
                  <span className="doc-name">{r.title}{r.id === current && <span className="chip chip--sm">On screen</span>}</span>
                  <span className="doc-when">Edited {ago(r.updated)}</span>
                  <span className="doc-actions">
                    <button className="btn btn--sm" type="button" disabled={r.id === current || busy} aria-label={`Open ${r.title}`}
                      onClick={async () => { setBusy(true); await openOnline(r.id); setBusy(false); }}>Open</button>
                    <button className="btn btn--sm btn--icon btn--ghost" type="button" aria-label={`Delete ${r.title}`} title="Delete" onClick={() => setAsking(r.id)}><Icon name="trash" /></button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function DevSignIn() {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => useCloud.setState({ panel: null });
  return (
    <Modal title="Sign in with a test account" onClose={close}>
      <form className="modal-form" onSubmit={async (e) => { e.preventDefault(); setError(await devSignIn(name)); }}>
        <p className="hint">Only on this computer, for trying the editor: no password. The same name is the same account.</p>
        <label className="field">Name<input className="input" autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions"><button className="btn btn--accent" type="submit">Sign in</button><button className="btn" type="button" onClick={close}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function Conflict() {
  const other = useCloud((s) => s.conflict)!;
  const title = useEditor((s) => s.diagram.title);
  const close = () => showConflict.set(false);
  return (
    <Modal title="This diagram changed somewhere else" onClose={close} alert>
      <p className="modal-text">“{other.title}” was saved from another tab or computer {ago(other.updated)}, while you were changing it here. Choose what to keep.</p>
      <div className="modal-choices">
        <button className="btn btn--accent" type="button" onClick={() => void settle('mine')}><b>Keep this one</b><span>The other version is replaced.</span></button>
        <button className="btn" type="button" onClick={() => void settle('theirs')}><b>Use the other one</b><span>This version stays in Undo.</span></button>
        <button className="btn" type="button" onClick={() => void settle('both')}><b>Keep both</b><span>This one is saved as “{`${title} (copy)`}”.</span></button>
      </div>
    </Modal>
  );
}

function SignOutUnsaved() {
  const close = () => useCloud.setState({ panel: null });
  return (
    <Modal title="Your last changes are not online yet" onClose={close} alert>
      <p className="modal-text">There is no connection to the server. Signing out now removes this diagram from this browser, with the changes that are not online.</p>
      <div className="modal-actions">
        <button className="btn btn--danger" type="button" onClick={() => void signOut(true)}>Sign out anyway</button>
        <button className="btn" type="button" autoFocus onClick={close}>Stay signed in</button>
      </div>
    </Modal>
  );
}

function DeleteAccount() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => useCloud.setState({ panel: null });
  return (
    <Modal title="Delete your account?" onClose={close} alert>
      <p className="modal-text">Your account and every diagram in it are deleted from the server for good. Diagrams you saved as files are not touched.</p>
      {error && <p className="modal-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn--danger" type="button" disabled={busy} onClick={async () => { setBusy(true); setError(await deleteAccount()); setBusy(false); }}>Delete account</button>
        <button className="btn" type="button" autoFocus onClick={close}>Cancel</button>
      </div>
    </Modal>
  );
}

export function CloudDialogs() {
  const panel = useCloud((s) => s.panel);
  const conflict = useCloud((s) => s.conflict);
  const [conflictOpen, setConflictOpen] = useState(showConflict.on);
  useEffect(() => {
    const on = () => setConflictOpen(showConflict.on);
    window.addEventListener('archboard:conflict', on);
    return () => window.removeEventListener('archboard:conflict', on);
  }, []);
  // A new conflict always shows its dialog.
  useEffect(() => { if (conflict) showConflict.set(true); }, [conflict]);
  if (conflict && conflictOpen) return <Conflict />;
  if (panel === 'list') return <MyDiagrams />;
  if (panel === 'dev') return <DevSignIn />;
  if (panel === 'delete') return <DeleteAccount />;
  if (panel === 'signout') return <SignOutUnsaved />;
  return null;
}
