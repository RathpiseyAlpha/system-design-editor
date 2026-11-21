// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromTemplate, serializeDiagram, type Diagram } from '@archboard/engine';

// A fake cloud service: an in-memory account, and a switch to drop the connection.
const server = {
  user: { id: 'u1', name: 'Dara' } as { id: string; name: string } | null,
  docs: new Map<string, { version: number; updated: number; diagram: Diagram }>(),
  offline: false,
  calls: [] as string[],
  next: 1,
};
const no = (status: number, error: string, extra = {}) => ({ ok: false as const, status, error, message: error, ...extra });
vi.mock('./api.ts', () => ({
  me: async () => ({ user: server.user, providers: [{ id: 'github', name: 'GitHub' }], dev: false }),
  list: async () => ({ ok: true, data: { max: 500, diagrams: [...server.docs].map(([id, d]) => ({ id, title: d.diagram.title, version: d.version, updated: d.updated, created: 0, bytes: 1 })).reverse() } }),
  get: async (id: string) => {
    server.calls.push(`GET ${id}`);
    const d = server.docs.get(id);
    return d ? { ok: true, data: { id, title: d.diagram.title, ...d } } : no(404, 'not-found');
  },
  create: async (diagram: Diagram) => {
    server.calls.push(`POST ${diagram.title}`);
    if (server.offline) return no(0, 'offline');
    const id = `d${server.next++}`;
    server.docs.set(id, { version: 1, updated: Date.now(), diagram });
    return { ok: true, data: { id, title: diagram.title, version: 1, updated: Date.now() } };
  },
  save: async (id: string, diagram: Diagram, base: number) => {
    server.calls.push(`PUT ${id}@${base} ${diagram.title}`);
    if (server.offline) return no(0, 'offline');
    const d = server.docs.get(id);
    if (!d) return no(404, 'not-found');
    if (d.version !== base) return no(409, 'conflict', { current: { id, title: d.diagram.title, ...d } });
    server.docs.set(id, { version: base + 1, updated: Date.now(), diagram });
    return { ok: true, data: { version: base + 1, updated: Date.now() } };
  },
  signOut: async () => { server.calls.push('SIGN OUT'); return { ok: true, data: undefined }; },
  remove: async () => ({ ok: true, data: undefined }),
  deleteAccount: async () => ({ ok: true, data: undefined }),
  devSignIn: async () => ({ ok: true, data: { user: server.user } }),
  signInUrl: (p: string) => `/auth/${p}`,
}));

async function boot() {
  vi.resetModules();
  const editor = await import('../state/store.ts');
  const cloud = await import('./store.ts');
  return { editor, cloud, useEditor: editor.useEditor, useCloud: cloud.useCloud };
}
const settle = async () => { await vi.advanceTimersByTimeAsync(1200); };
const binding = () => JSON.parse(localStorage.getItem('archboard:online') ?? 'null');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  server.user = { id: 'u1', name: 'Dara' };
  server.docs.clear();
  server.offline = false;
  server.calls = [];
  server.next = 1;
});
afterEach(() => { vi.useRealTimers(); });

describe('online saving', () => {
  it('first sign-in: the diagram already in this browser becomes a new online diagram', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram({ ...fromTemplate('three-tier'), title: 'My work' }));
    const { cloud, useCloud } = await boot();
    await cloud.start();
    await settle();
    expect(server.calls).toEqual(['POST My work']);
    expect(useCloud.getState()).toMatchObject({ status: 'in', doc: { id: 'd1', version: 1 }, sync: 'saved' });
    expect(binding()).toEqual({ user: 'u1', id: 'd1', version: 1, dirty: false });
  });

  it('an edit is saved a second later with the version it was made to; New starts another online diagram', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram(fromTemplate('three-tier')));
    const { cloud, useEditor, useCloud } = await boot();
    await cloud.start();
    await settle();
    useEditor.getState().setTitle('Shop v2');
    expect(useCloud.getState().sync).toBe('saving'); // not "Saved" while the change waits for its second
    await vi.advanceTimersByTimeAsync(500);
    expect(server.calls).toHaveLength(1);
    await settle();
    expect(server.calls.at(-1)).toBe('PUT d1@1 Shop v2');
    useEditor.getState().newFromTemplate('serverless');
    await settle();
    expect(server.calls.at(-1)).toMatch(/^POST /);
    expect(server.docs.size).toBe(2);
  });

  it('a save over a newer version is a conflict; keeping this one overwrites, knowingly', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram(fromTemplate('three-tier')));
    const { cloud, useEditor, useCloud } = await boot();
    await cloud.start();
    await settle();
    // Another tab saves first.
    const other = server.docs.get('d1')!;
    server.docs.set('d1', { ...other, version: 2, diagram: { ...other.diagram, title: 'From the other tab' } });
    useEditor.getState().setTitle('From here');
    await settle();
    expect(useCloud.getState().sync).toBe('conflict');
    expect(useCloud.getState().conflict?.title).toBe('From the other tab');
    // Nothing more is sent until the person chooses.
    useEditor.getState().setTitle('From here, again');
    await settle();
    expect(server.calls.filter((c) => c.startsWith('PUT'))).toHaveLength(1);
    await cloud.settle('mine');
    expect(server.calls.at(-1)).toBe('PUT d1@2 From here, again');
    expect(server.docs.get('d1')!.version).toBe(3);
    expect(useCloud.getState().sync).toBe('saved');
  });

  it('a conflict settled the other way keeps this version in Undo; "keep both" makes a copy', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram(fromTemplate('three-tier')));
    const { cloud, useEditor } = await boot();
    await cloud.start();
    await settle();
    const bump = (title: string) => { const d = server.docs.get('d1')!; server.docs.set('d1', { ...d, version: d.version + 1, diagram: { ...d.diagram, title } }); };
    bump('Theirs');
    useEditor.getState().setTitle('Mine');
    await settle();
    await cloud.settle('theirs');
    expect(useEditor.getState().diagram.title).toBe('Theirs');
    useEditor.getState().undo();
    expect(useEditor.getState().diagram.title).toBe('Mine');
    await settle();
    bump('Theirs again');
    useEditor.getState().setTitle('Mine again');
    await settle();
    await cloud.settle('both');
    expect(server.docs.get('d1')!.diagram.title).toBe('Theirs again');
    expect([...server.docs.values()].map((d) => d.diagram.title)).toContain('Mine again (copy)');
  });

  it('another person\'s work on this computer never goes into this account', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram({ ...fromTemplate('three-tier'), title: 'Sok private' }));
    localStorage.setItem('archboard:online', JSON.stringify({ user: 'someone-else', id: 'x9', version: 4, dirty: true }));
    server.docs.set('d7', { version: 1, updated: 1, diagram: { ...fromTemplate('serverless'), title: 'Dara latest' } });
    const { cloud, useEditor } = await boot();
    await cloud.start();
    await settle();
    expect(server.calls.some((c) => c.includes('Sok private'))).toBe(false);
    expect(useEditor.getState().diagram.title).toBe('Dara latest');
    expect(useEditor.getState().past).toEqual([]);
  });

  it('... also when this account has nothing online yet: the next edit does not send the other person\'s diagram', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram({ ...fromTemplate('three-tier'), title: 'Sok private' }));
    localStorage.setItem('archboard:online', JSON.stringify({ user: 'someone-else', id: 'x9', version: 4, dirty: false }));
    const { cloud, useEditor } = await boot();
    await cloud.start();
    await settle();
    expect(useEditor.getState().diagram.title).not.toBe('Sok private');
    useEditor.getState().add('vm');
    await settle();
    expect(server.calls.some((c) => c.includes('Sok private'))).toBe(false);
    expect(useEditor.getState().past.some((d) => d.title === 'Sok private')).toBe(false);
  });

  it('signing out leaves nothing behind: no autosave, no link, no history', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram({ ...fromTemplate('three-tier'), title: 'Dara private' }));
    const { cloud, useEditor, useCloud } = await boot();
    await cloud.start();
    await settle();
    useEditor.getState().setTitle('Dara private v2');
    await settle();
    expect(await cloud.signOut()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(useCloud.getState().status).toBe('out');
    expect(localStorage.getItem('archboard:autosave')).toBeNull();
    expect(localStorage.getItem('archboard:online')).toBeNull();
    expect(useEditor.getState().past).toEqual([]);
    expect(useEditor.getState().diagram.title).not.toMatch(/Dara/);
  });

  it('signing out in another tab signs this tab out too, and its next edit leaves nothing behind', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram({ ...fromTemplate('three-tier'), title: 'Dara private' }));
    const { cloud, useEditor, useCloud } = await boot();
    await cloud.start();
    await settle();
    server.calls = [];
    // Tab A signs out: it removes the link and the autosave (a storage event reaches this tab).
    localStorage.removeItem('archboard:online');
    localStorage.removeItem('archboard:autosave');
    window.dispatchEvent(new StorageEvent('storage', { key: 'archboard:online', oldValue: 'x', newValue: null }));
    expect(useCloud.getState().status).toBe('out');
    expect(useEditor.getState().diagram.title).not.toBe('Dara private');
    expect(useEditor.getState().past).toEqual([]);
    useEditor.getState().add('vm');
    await settle();
    expect(localStorage.getItem('archboard:online')).toBeNull();
    expect(localStorage.getItem('archboard:autosave') ?? '').not.toContain('Dara private');
    expect(server.calls).toEqual([]);
  });

  it('offline: the change waits, is kept in this browser, and goes when the connection returns', async () => {
    localStorage.setItem('archboard:autosave', serializeDiagram(fromTemplate('three-tier')));
    const { cloud, useEditor, useCloud } = await boot();
    await cloud.start();
    await settle();
    server.offline = true;
    useEditor.getState().setTitle('Written offline');
    await settle();
    expect(useCloud.getState().sync).toBe('offline');
    expect(binding().dirty).toBe(true);
    // Signing out now needs a yes, because the change would be lost.
    expect(await cloud.signOut()).toBe(false);
    expect(useCloud.getState().panel).toBe('signout');
    useCloud.setState({ panel: null });
    server.offline = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.docs.get('d1')!.diagram.title).toBe('Written offline');
    expect(useCloud.getState().sync).toBe('saved');
    expect(binding().dirty).toBe(false);
  });

  it('reopened later: changes made offline are sent, and a diagram changed elsewhere meanwhile asks first', async () => {
    server.docs.set('d1', { version: 3, updated: 1, diagram: { ...fromTemplate('three-tier'), title: 'Online' } });
    localStorage.setItem('archboard:autosave', serializeDiagram({ ...fromTemplate('three-tier'), title: 'Offline edit' }));
    localStorage.setItem('archboard:online', JSON.stringify({ user: 'u1', id: 'd1', version: 3, dirty: true }));
    let b = await boot();
    await b.cloud.start();
    await settle();
    expect(server.calls.at(-1)).toBe('PUT d1@3 Offline edit');
    localStorage.setItem('archboard:online', JSON.stringify({ user: 'u1', id: 'd1', version: 3, dirty: true }));
    server.calls = [];
    b = await boot();
    await b.cloud.start();
    await settle();
    expect(b.useCloud.getState().sync).toBe('conflict');
    expect(server.calls.filter((c) => c.startsWith('PUT'))).toEqual([]);
  });

  it('no cloud service: nothing changes', async () => {
    const { cloud, useCloud } = await boot();
    const api = await import('./api.ts');
    vi.spyOn(api, 'me').mockResolvedValueOnce(null);
    await cloud.start();
    expect(useCloud.getState().status).toBe('off');
  });
});
