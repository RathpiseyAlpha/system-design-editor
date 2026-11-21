// The cloud API (SPEC section 8.3): sign-in, sessions and each person's diagrams. The same service serves the editor's
// files (server.ts), so the editor and the API share one address: the session cookie is first-party and there is no CORS.
//
//   GET    /api/me                  -> {user: {id, name} | null, providers: [{id, name}], dev}
//   POST   /api/sign-out            -> 204, the session ends
//   DELETE /api/me                  -> 204, the person, their sessions and all their diagrams are deleted
//   GET    /auth/:provider          -> 302 to the provider;  GET /auth/:provider/callback -> 302 back to the editor
//   POST   /auth/dev {name}         -> only with ARCHBOARD_DEV_LOGIN on a local address: a test account, no provider
//   GET    /api/diagrams            -> {diagrams: [{id, title, version, updated, created, bytes}], max}
//   POST   /api/diagrams {diagram}  -> 201 {id, title, version, updated}
//   GET    /api/diagrams/:id        -> {id, title, version, updated, diagram}
//   PUT    /api/diagrams/:id {diagram, base}  -> {version, updated}, or 409 {current} when it changed since `base`
//   DELETE /api/diagrams/:id        -> 204
//
// Rules: a request that changes anything must come from the editor's own page (its Origin header); another person's
// diagram is "not found", never "forbidden"; every diagram goes through the file format's schema and limits; nothing
// from a request body or a cookie is written to the log.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { LIMITS, parseDiagram, serializeDiagram } from '@archboard/engine';
import type { Store, User } from './db.ts';
import { DEFAULT_RATE, Limiter, type RateLimit } from './limit.ts';
import type { Provider } from './providers.ts';

const DAY = 86_400_000;
/** A session lasts 30 days from the last visit; it is renewed when less than 15 are left. */
export const SESSION_DAYS = 30;
/** Diagrams a person may keep. */
export const MAX_DIAGRAMS = 500;
const MAX_BODY = LIMITS.bytes + 8 * 1024;

export interface AppOptions {
  store: Store;
  /** The address people open the editor at (also where providers send the browser back to). */
  publicUrl: URL;
  providers: Provider[];
  /** Offer test accounts without a provider. Only for a local address (server.ts refuses it otherwise). */
  devLogin?: boolean;
  rate?: RateLimit;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

type Env = { Variables: { user: User | null; session: string | null } };

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createApp(o: AppOptions) {
  const app = new Hono<Env>();
  const now = o.now ?? Date.now;
  const log = o.log ?? ((line) => console.log(JSON.stringify(line)));
  const limiter = new Limiter(o.rate ?? DEFAULT_RATE, now);
  const secure = o.publicUrl.protocol === 'https:';
  // On https the cookie gets the __Host- prefix: only this exact host, path / and Secure, so no subdomain can set it.
  const SESSION = 'archboard_session', prefix = secure ? ('host' as const) : undefined;
  const OAUTH = 'archboard_oauth';
  const home = (q = '') => new URL(q, o.publicUrl).toString();
  const byId = new Map(o.providers.map((p) => [p.id, p]));

  app.use('*', async (c, next) => {
    const t = Date.now();
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    log({ at: new Date(t).toISOString(), method: c.req.method, path: c.req.path.replace(/\/diagrams\/[^/]+$/, '/diagrams/:id'), status: c.res.status, ms: Date.now() - t, user: c.get('user')?.id ?? null });
  });

  // Anything that changes data must come from the editor's own page. SameSite=Lax already keeps the cookie off other
  // sites' form posts; the Origin check closes the rest (and a request with no Origin is refused).
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/'))) {
      if (c.req.header('origin') !== o.publicUrl.origin) return c.json({ error: 'bad-origin', message: 'This request did not come from the editor\'s page.' }, 403);
    }
    await next();
  });

  // Who is asking: the session cookie, looked up by its hash, renewed when it is getting old.
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.set('user', null);
    c.set('session', null);
    const token = getCookie(c, SESSION, prefix);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const hash = hashToken(token), s = o.store.session(hash), t = now();
      if (s && s.expires > t) {
        const user = o.store.user(s.user_id);
        if (user) {
          c.set('user', user);
          c.set('session', hash);
          if (s.expires - t < (SESSION_DAYS / 2) * DAY) {
            o.store.extendSession(hash, t + SESSION_DAYS * DAY);
            setSession(c, token);
          }
        }
      } else if (s) {
        o.store.deleteSession(hash);
      }
    }
    await next();
  });

  function setSession(c: Context, token: string) {
    setCookie(c, SESSION, token, { prefix, path: '/', httpOnly: true, secure, sameSite: 'Lax', maxAge: SESSION_DAYS * 86_400 });
  }
  function startSession(c: Context, user: User) {
    const token = randomBytes(32).toString('base64url');
    o.store.addSession(hashToken(token), user.id, now() + SESSION_DAYS * DAY);
    setSession(c, token);
  }
  const publicUser = (u: User) => ({ id: u.id, name: u.name });

  // Me, sign-out, delete account --------------------------------------------------------------------------------------

  app.get('/api/me', (c) => {
    const u = c.get('user');
    return c.json({ user: u ? publicUser(u) : null, providers: o.providers.map((p) => ({ id: p.id, name: p.name })), dev: !!o.devLogin });
  });

  app.post('/api/sign-out', (c) => {
    const s = c.get('session');
    if (s) o.store.deleteSession(s);
    deleteCookie(c, SESSION, { prefix, path: '/', secure });
    return c.body(null, 204);
  });

  app.delete('/api/me', (c) => {
    const u = c.get('user');
    if (!u) return signedOut(c);
    o.store.deleteUser(u.id);
    deleteCookie(c, SESSION, { prefix, path: '/', secure });
    log({ at: new Date(now()).toISOString(), msg: 'account deleted', user: u.id });
    return c.body(null, 204);
  });

  // Sign-in through a provider --------------------------------------------------------------------------------------

  app.get('/auth/:provider', (c) => {
    const p = byId.get(c.req.param('provider'));
    if (!p) return c.json({ error: 'not-found' }, 404);
    const { url, state, verifier } = p.start();
    // Lax, so the cookie comes back with the provider's top-level redirect; ten minutes to finish signing in.
    setCookie(c, OAUTH, `${p.id}.${state}.${verifier}`, { path: '/auth', httpOnly: true, secure, sameSite: 'Lax', maxAge: 600 });
    return c.redirect(url.toString(), 302);
  });

  app.get('/auth/:provider/callback', async (c) => {
    const p = byId.get(c.req.param('provider'));
    if (!p) return c.json({ error: 'not-found' }, 404);
    const saved = getCookie(c, OAUTH) ?? '';
    deleteCookie(c, OAUTH, { path: '/auth', secure });
    const [pid = '', state = '', verifier = ''] = saved.split('.');
    const code = c.req.query('code'), back = c.req.query('state');
    if (!code || !back || pid !== p.id || !state || !same(state, back)) return c.redirect(home('?signin=failed'), 302);
    try {
      const who = await p.finish(code, verifier);
      startSession(c, o.store.upsertUser(p.id, who.subject, who.name, now()));
      return c.redirect(home('?signin=ok'), 302);
    } catch (e) {
      log({ at: new Date(now()).toISOString(), msg: 'sign-in failed', provider: p.id, error: String((e as Error).message ?? e).slice(0, 200) });
      return c.redirect(home('?signin=failed'), 302);
    }
  });

  if (o.devLogin) {
    app.post('/auth/dev', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
      const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
      if (!name) return c.json({ error: 'bad-request', message: 'Send {"name": "..."}.' }, 400);
      const user = o.store.upsertUser('dev', name.toLowerCase(), name, now());
      startSession(c, user);
      return c.json({ user: publicUser(user) });
    });
  }

  // Diagrams ------------------------------------------------------------------------------------------------------------

  const signedOut = (c: Context) => c.json({ error: 'signed-out', message: 'Sign in to keep diagrams online.' }, 401);
  const notFound = (c: Context) => c.json({ error: 'not-found', message: 'There is no such diagram in your account.' }, 404);

  app.use('/api/diagrams/*', guard);
  async function guard(c: Context<Env>, next: () => Promise<void>) {
    const u = c.get('user');
    if (!u) return signedOut(c);
    const wait = limiter.take(u.id);
    if (wait) { c.header('Retry-After', String(wait)); return c.json({ error: 'rate-limited', message: `Too many requests: try again in ${wait} s.` }, 429); }
    if ((c.req.method === 'POST' || c.req.method === 'PUT') && !/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
      return c.json({ error: 'not-json', message: 'Send the body as application/json.' }, 415);
    }
    await next();
  }
  const limit = bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: 'too-large', message: `A diagram can be at most ${LIMITS.bytes / 1024} KB.` }, 413) });

  /** The body's diagram, checked by the file format, as its canonical text. */
  async function readDiagram(c: Context): Promise<{ ok: true; title: string; body: string; base: unknown } | { ok: false; res: Response }> {
    let data: unknown;
    try { data = await c.req.json(); } catch { return { ok: false, res: c.json({ error: 'bad-request', message: 'The body is not JSON.' }, 400) }; }
    if (!data || typeof data !== 'object' || !('diagram' in data)) return { ok: false, res: c.json({ error: 'bad-request', message: 'Send {"diagram": ...}.' }, 400) };
    const r = parseDiagram((data as { diagram: unknown }).diagram);
    if (!r.ok) return { ok: false, res: c.json({ error: 'bad-diagram', message: 'This is not a valid diagram.', errors: r.errors.slice(0, 10) }, 400) };
    const body = serializeDiagram(r.diagram);
    if (Buffer.byteLength(body) > LIMITS.bytes) return { ok: false, res: c.json({ error: 'too-large', message: `A diagram can be at most ${LIMITS.bytes / 1024} KB.` }, 413) };
    return { ok: true, title: r.diagram.title, body, base: (data as { base?: unknown }).base };
  }

  app.get('/api/diagrams', (c) => c.json({ diagrams: o.store.list(c.get('user')!.id), max: MAX_DIAGRAMS }));

  app.post('/api/diagrams', limit, async (c) => {
    const u = c.get('user')!;
    const d = await readDiagram(c);
    if (!d.ok) return d.res;
    if (o.store.count(u.id) >= MAX_DIAGRAMS) return c.json({ error: 'full', message: `You have ${MAX_DIAGRAMS} diagrams online, the most there can be. Delete some first.` }, 409);
    const row = o.store.create(u.id, d.title, d.body, now());
    return c.json({ id: row.id, title: row.title, version: row.version, updated: row.updated }, 201);
  });

  app.get('/api/diagrams/:id', (c) => {
    const doc = o.store.get(c.get('user')!.id, c.req.param('id'));
    if (!doc) return notFound(c);
    const { body, ...row } = doc;
    return c.json({ ...row, diagram: JSON.parse(body) });
  });

  app.put('/api/diagrams/:id', limit, async (c) => {
    const u = c.get('user')!, id = c.req.param('id');
    const d = await readDiagram(c);
    if (!d.ok) return d.res;
    if (!Number.isInteger(d.base) || (d.base as number) < 1) return c.json({ error: 'bad-request', message: 'Send the version the change was made to as "base".' }, 400);
    const t = now();
    if (o.store.replace(u.id, id, d.base as number, d.title, d.body, t)) return c.json({ version: (d.base as number) + 1, updated: t });
    const cur = o.store.get(u.id, id);
    if (!cur) return notFound(c);
    const { body, ...row } = cur;
    return c.json({ error: 'conflict', message: 'This diagram was changed somewhere else.', current: { ...row, diagram: JSON.parse(body) } }, 409);
  });

  app.delete('/api/diagrams/:id', (c) => (o.store.remove(c.get('user')!.id, c.req.param('id')) ? c.body(null, 204) : notFound(c)));

  app.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));
  app.onError((e, c) => {
    log({ at: new Date(now()).toISOString(), msg: 'error', error: String((e as Error).message ?? e).slice(0, 200) });
    return c.json({ error: 'server-error' }, 500);
  });
  return app;
}
