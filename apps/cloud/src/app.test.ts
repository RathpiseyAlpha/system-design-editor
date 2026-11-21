import { describe, expect, it } from 'vitest';
import { fromTemplate, LIMITS, serializeDiagram } from '@archboard/engine';
import { createApp, hashToken, MAX_DIAGRAMS } from './app.ts';
import { Store } from './db.ts';
import { github, google, type Provider } from './providers.ts';

const URL_ = new URL('http://localhost:8788/');
const ORIGIN = URL_.origin;
const shop = JSON.parse(serializeDiagram(fromTemplate('three-tier')));

/** A provider that signs in whoever the test names in the code ("code-<subject>"). */
const fake: Provider = {
  id: 'fake', name: 'Fake',
  start: () => ({ url: new URL('https://provider.example/authorize?x=1'), state: 'S'.repeat(43), verifier: 'V'.repeat(43) }),
  finish: async (code, verifier) => {
    if (verifier !== 'V'.repeat(43)) throw new Error('verifier lost');
    if (!code.startsWith('code-')) throw new Error('bad code');
    return { subject: code.slice(5), name: `Person ${code.slice(5)}` };
  },
};

function setup(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  const store = new Store(':memory:');
  let t = 1_800_000_000_000;
  const lines: Record<string, unknown>[] = [];
  const app = createApp({ store, publicUrl: URL_, providers: [fake], devLogin: true, now: () => t, log: (l) => lines.push(l), ...over });
  const req = (path: string, init: RequestInit & { cookie?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set('cookie', init.cookie);
    if (init.method && init.method !== 'GET' && !headers.has('origin')) headers.set('origin', ORIGIN);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return app.request(path, { ...init, headers });
  };
  const cookieOf = (r: Response) => /archboard_session=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];
  const signIn = async (name: string) => {
    const r = await req('/auth/dev', { method: 'POST', body: JSON.stringify({ name }) });
    expect(r.status).toBe(200);
    return `archboard_session=${cookieOf(r)}`;
  };
  return { store, app, req, signIn, cookieOf, lines, advance: (ms: number) => { t += ms; } };
}

describe('sessions', () => {
  it('signs in, says who is signed in, and signs out', async () => {
    const { req, signIn } = setup();
    expect(await (await req('/api/me')).json()).toEqual({ user: null, providers: [{ id: 'fake', name: 'Fake' }], dev: true });
    const cookie = await signIn('Dara');
    const me = await (await req('/api/me', { cookie })).json() as { user: { name: string } };
    expect(me.user.name).toBe('Dara');
    expect((await req('/api/sign-out', { method: 'POST', cookie })).status).toBe(204);
    expect((await (await req('/api/me', { cookie })).json() as { user: unknown }).user).toBeNull();
  });

  it('keeps only a hash of the token, and the cookie is HttpOnly and SameSite=Lax', async () => {
    const { req, store, cookieOf } = setup();
    const r = await req('/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'Dara' }) });
    const token = cookieOf(r)!;
    expect(r.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(r.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    expect(store.session(token)).toBeUndefined();
    expect(store.session(hashToken(token))).toBeDefined();
  });

  it('on https the cookie is __Host- and Secure', async () => {
    const { req } = setup({ publicUrl: new URL('https://archboard.example.org/') });
    const r = await req('/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'Dara' }), headers: { origin: 'https://archboard.example.org' } });
    expect(r.headers.get('set-cookie')).toMatch(/^__Host-archboard_session=.*Secure/i);
  });

  it('a session ends 30 days after the last visit, and a visit renews it', async () => {
    const { req, signIn, advance } = setup();
    const cookie = await signIn('Dara');
    advance(20 * 86_400_000);
    expect(((await (await req('/api/me', { cookie })).json()) as { user: unknown }).user).not.toBeNull(); // renewed here
    advance(25 * 86_400_000);
    expect(((await (await req('/api/me', { cookie })).json()) as { user: unknown }).user).not.toBeNull();
    advance(31 * 86_400_000);
    expect(((await (await req('/api/me', { cookie })).json()) as { user: unknown }).user).toBeNull();
  });

  it('refuses a change that does not come from the editor\'s page', async () => {
    const { req, signIn } = setup();
    const cookie = await signIn('Dara');
    for (const origin of ['https://evil.example', '']) {
      const r = await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: shop }), headers: origin ? { origin } : { origin: 'null' } });
      expect(r.status).toBe(403);
    }
    const noOrigin = await req('/api/sign-out', { method: 'POST', cookie, headers: { origin: '' } });
    expect(noOrigin.status).toBe(403);
  });

  it('dev sign-in exists only when turned on', async () => {
    const { req } = setup({ devLogin: false });
    expect((await req('/auth/dev', { method: 'POST', body: JSON.stringify({ name: 'x' }) })).status).toBe(404);
    expect(((await (await req('/api/me')).json()) as { dev: boolean }).dev).toBe(false);
  });
});

describe('sign-in through a provider', () => {
  it('redirects to the provider, then back with a session when the state matches', async () => {
    const { req, cookieOf } = setup();
    const start = await req('/auth/fake');
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toBe('https://provider.example/authorize?x=1');
    const oauth = /archboard_oauth=([^;]+)/.exec(start.headers.get('set-cookie')!)![1];
    const back = await req(`/auth/fake/callback?code=code-42&state=${'S'.repeat(43)}`, { cookie: `archboard_oauth=${oauth}` });
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('http://localhost:8788/?signin=ok');
    const me = await (await req('/api/me', { cookie: `archboard_session=${cookieOf(back)}` })).json() as { user: { name: string } };
    expect(me.user.name).toBe('Person 42');
  });

  it('a wrong or missing state signs no one in', async () => {
    const { req } = setup();
    const start = await req('/auth/fake');
    const oauth = /archboard_oauth=([^;]+)/.exec(start.headers.get('set-cookie')!)![1];
    for (const [q, cookie] of [[`code=code-1&state=${'T'.repeat(43)}`, `archboard_oauth=${oauth}`], [`code=code-1&state=${'S'.repeat(43)}`, '']] as const) {
      const r = await req(`/auth/fake/callback?${q}`, { cookie });
      expect(r.headers.get('location')).toBe('http://localhost:8788/?signin=failed');
      expect(r.headers.get('set-cookie') ?? '').not.toMatch(/archboard_session=[A-Za-z0-9_-]{43}/);
    }
  });

  it('the same provider account is the same person; the name follows the provider', async () => {
    const { store } = setup();
    const a = store.upsertUser('github', '7', 'Dara', 1), b = store.upsertUser('github', '7', 'Dara Sok', 2), c = store.upsertUser('google', '7', 'X', 3);
    expect(b.id).toBe(a.id);
    expect(store.user(a.id)!.name).toBe('Dara Sok');
    expect(c.id).not.toBe(a.id);
  });

  it('GitHub and Google: the right requests, and only the id and name kept', async () => {
    const calls: { url: string; body?: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
      const u = String(url);
      if (u.includes('github.com/login/oauth/access_token')) return Response.json({ access_token: 'gho_x' });
      if (u === 'https://api.github.com/user') return Response.json({ id: 99, login: 'dara', name: null, email: 'd@x' });
      if (u === 'https://oauth2.googleapis.com/token') {
        const claims = Buffer.from(JSON.stringify({ sub: 'g-1', aud: 'gid', iss: 'https://accounts.google.com', name: 'Dara Sok', email: 'd@x' })).toString('base64url');
        return Response.json({ id_token: `h.${claims}.s` });
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const gh = github('cid', 'sec', 'http://localhost:8788/auth/github/callback', f);
    const s = gh.start();
    expect(s.url.searchParams.get('state')).toBe(s.state);
    expect(s.url.searchParams.get('scope')).toBeNull();
    expect(await gh.finish('c1', '')).toEqual({ subject: '99', name: 'dara' });
    const go = google('gid', 'gsec', 'http://localhost:8788/auth/google/callback', f);
    const g = go.start();
    expect(g.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(g.url.searchParams.get('scope')).toBe('openid profile');
    expect(await go.finish('c2', g.verifier)).toEqual({ subject: 'g-1', name: 'Dara Sok' });
    expect(calls.find((c) => c.url.includes('googleapis'))!.body).toContain(`code_verifier=${g.verifier}`);
    // An id token for another app is refused.
    const other = google('someone-else', 'x', 'http://localhost:8788/auth/google/callback', f);
    await expect(other.finish('c3', 'v')).rejects.toThrow(/not for this service/);
  });
});

describe('diagrams', () => {
  it('create, list, open, save and delete one\'s own diagrams', async () => {
    const { req, signIn } = setup();
    const cookie = await signIn('Dara');
    const made = await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: shop }) });
    expect(made.status).toBe(201);
    const { id, version } = await made.json() as { id: string; version: number };
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(version).toBe(1);
    const list = await (await req('/api/diagrams', { cookie })).json() as { diagrams: { id: string; title: string }[]; max: number };
    expect(list.diagrams.map((d) => [d.id, d.title])).toEqual([[id, shop.title]]);
    expect(list.max).toBe(MAX_DIAGRAMS);
    const renamed = { ...shop, title: 'Shop v2' };
    const put = await req(`/api/diagrams/${id}`, { method: 'PUT', cookie, body: JSON.stringify({ diagram: renamed, base: 1 }) });
    expect(await put.json()).toMatchObject({ version: 2 });
    const got = await (await req(`/api/diagrams/${id}`, { cookie })).json() as { title: string; version: number; diagram: { title: string } };
    expect([got.title, got.version, got.diagram.title]).toEqual(['Shop v2', 2, 'Shop v2']);
    expect((await req(`/api/diagrams/${id}`, { method: 'DELETE', cookie })).status).toBe(204);
    expect((await req(`/api/diagrams/${id}`, { cookie })).status).toBe(404);
  });

  it('a save made to an old version is a conflict, with the current copy', async () => {
    const { req, signIn } = setup();
    const cookie = await signIn('Dara');
    const { id } = await (await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: shop }) })).json() as { id: string };
    await req(`/api/diagrams/${id}`, { method: 'PUT', cookie, body: JSON.stringify({ diagram: { ...shop, title: 'From tab A' }, base: 1 }) });
    const r = await req(`/api/diagrams/${id}`, { method: 'PUT', cookie, body: JSON.stringify({ diagram: { ...shop, title: 'From tab B' }, base: 1 }) });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'conflict', current: { version: 2, diagram: { title: 'From tab A' } } });
  });

  it('another person\'s diagram is not found, whatever is asked', async () => {
    const { req, signIn } = setup();
    const a = await signIn('Dara'), b = await signIn('Sok');
    const { id } = await (await req('/api/diagrams', { method: 'POST', cookie: a, body: JSON.stringify({ diagram: shop }) })).json() as { id: string };
    expect((await req(`/api/diagrams/${id}`, { cookie: b })).status).toBe(404);
    expect((await req(`/api/diagrams/${id}`, { method: 'PUT', cookie: b, body: JSON.stringify({ diagram: shop, base: 1 }) })).status).toBe(404);
    expect((await req(`/api/diagrams/${id}`, { method: 'DELETE', cookie: b })).status).toBe(404);
    expect(((await (await req('/api/diagrams', { cookie: b })).json()) as { diagrams: unknown[] }).diagrams).toEqual([]);
    expect((await req(`/api/diagrams/${id}`, { cookie: a })).status).toBe(200);
  });

  it('signed out, too large, not JSON, not a diagram, no base', async () => {
    const { req, signIn } = setup();
    expect((await req('/api/diagrams')).status).toBe(401);
    const cookie = await signIn('Dara');
    const big = { ...shop, notes: 'x'.repeat(LIMITS.bytes + 16 * 1024) };
    expect((await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: big }) })).status).toBe(413);
    expect((await req('/api/diagrams', { method: 'POST', cookie, body: 'diagram', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    const bad = await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: { format: 'nope' } }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'bad-diagram' });
    const { id } = await (await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: shop }) })).json() as { id: string };
    expect((await req(`/api/diagrams/${id}`, { method: 'PUT', cookie, body: JSON.stringify({ diagram: shop }) })).status).toBe(400);
  });

  it('a person can keep at most MAX_DIAGRAMS', async () => {
    const { req, signIn, store } = setup();
    const cookie = await signIn('Dara');
    const uid = ((await (await req('/api/me', { cookie })).json()) as { user: { id: string } }).user.id;
    for (let i = 0; i < MAX_DIAGRAMS; i++) store.create(uid, `d${i}`, '{}', i);
    const r = await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: shop }) });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'full' });
  });

  it('rate limits each person', async () => {
    const { req, signIn } = setup({ rate: { burst: 3, perMinute: 3 } });
    const cookie = await signIn('Dara');
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await req('/api/diagrams', { cookie })).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it('deleting the account deletes its diagrams and sessions; nothing from bodies is logged', async () => {
    const { req, signIn, store, lines } = setup();
    const cookie = await signIn('Dara');
    await req('/api/diagrams', { method: 'POST', cookie, body: JSON.stringify({ diagram: { ...shop, title: 'Secret plan' } }) });
    expect((await req('/api/me', { method: 'DELETE', cookie })).status).toBe(204);
    expect((store.db.prepare('SELECT count(*) AS n FROM diagrams').get() as { n: number }).n).toBe(0);
    expect((store.db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }).n).toBe(0);
    expect((await req('/api/diagrams', { cookie })).status).toBe(401);
    expect(JSON.stringify(lines)).not.toMatch(/Secret plan|Dara|archboard_session/);
  });
});
