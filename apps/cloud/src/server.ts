// The cloud service's entry (built to dist/server.js by build.mjs): the API of app.ts plus the editor's built files, from
// one address. Settings come from the environment:
//   PUBLIC_URL            the address people open, e.g. https://archboard.example.org/ (required)
//   ARCHBOARD_DB          the SQLite file (default ./data/archboard.db)
//   ARCHBOARD_STATIC      the editor's build to serve (default ./public; apps/editor/dist when run from the repository)
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   the sign-in providers to offer
//   ARCHBOARD_DEV_LOGIN=1 test accounts without a provider; refused unless PUBLIC_URL is localhost or 127.0.0.1
//   PORT                  default 8788        HOST  default 0.0.0.0
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app.ts';
import { Store } from './db.ts';
import { providersFromEnv } from './providers.ts';

const fail = (msg: string): never => { console.error(msg); process.exit(1); };

let publicUrl: URL;
try { publicUrl = new URL(process.env.PUBLIC_URL ?? ''); } catch { fail('PUBLIC_URL is missing or not an address, for example PUBLIC_URL=https://archboard.example.org/'); }
publicUrl = publicUrl!;
// The editor, /api and /auth live at the root of their own address (a subdomain, not a folder of another site).
if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) fail('PUBLIC_URL must be the root of an address, for example https://archboard.example.org/ (no folder).');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
if (!local && publicUrl.protocol !== 'https:') fail('PUBLIC_URL must be https:// unless it is a local address.');
const devLogin = process.env.ARCHBOARD_DEV_LOGIN === '1';
if (devLogin && !local) fail('ARCHBOARD_DEV_LOGIN signs anyone in without a password: it only works with a local PUBLIC_URL.');

const dbPath = resolve(process.env.ARCHBOARD_DB ?? 'data/archboard.db');
mkdirSync(dirname(dbPath), { recursive: true });
const store = new Store(dbPath);
store.deleteExpiredSessions(Date.now());
setInterval(() => store.deleteExpiredSessions(Date.now()), 3_600_000).unref();

const providers = providersFromEnv(process.env, publicUrl);
const api = createApp({ store, publicUrl, providers, devLogin });

const root = resolve(process.env.ARCHBOARD_STATIC ?? 'public');
if (!existsSync(resolve(root, 'index.html'))) fail(`There is no editor build in ${root}: build apps/editor and set ARCHBOARD_STATIC.`);

const app = new Hono();
app.route('/', api);
// The editor's files. The pages and the service worker are checked on every visit (a new build is seen at once); files
// with a hash in their name never change, so browsers may keep them. Only the /embed/ page may be shown inside another site.
app.use('*', async (c, next) => {
  await next();
  const p = c.req.path;
  c.header('Cache-Control', /\/assets\/.+-[A-Za-z0-9_-]{8,}\./.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache');
  if (!p.startsWith('/embed/')) c.header('Content-Security-Policy', "frame-ancestors 'none'");
});
app.use('*', serveStatic({ root, rewriteRequestPath: (p) => p }));
app.notFound((c) => c.json({ error: 'not-found' }, 404));

const port = Number(process.env.PORT ?? 8788);
// Test accounts sign anyone in by name: then the service answers this computer only (curl can forge an Origin header).
if (devLogin && process.env.HOST && process.env.HOST !== '127.0.0.1') fail('ARCHBOARD_DEV_LOGIN listens on 127.0.0.1 only: leave HOST unset.');
const hostname = devLogin ? '127.0.0.1' : process.env.HOST ?? '0.0.0.0';
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'cloud listening', port: info.port, public: publicUrl.toString(), providers: providers.map((p) => p.id), dev: devLogin }));
});
const stop = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
