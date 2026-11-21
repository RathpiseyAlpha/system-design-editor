// The checker API (SPEC section 8.2), as a Hono app with nothing of its own to remember: no database, no accounts, no
// student data, and nothing from a request body in the log.
//
//   GET  /v1/health                     -> {ok, engine}
//   POST /v1/check  {diagram, ruleset}  -> {valid, results: [{id, pass, points, message}], score, max, errors?, engine}
//
// POST needs "Authorization: Bearer <host key>" and "Content-Type: application/json". There is no CORS: this is a server to
// server API (labsite's Flask server calls it), and a browser page on another site cannot call it at all.
// Answers: 200 the result (a diagram that is not valid is a result: valid false, score 0); 400 a request or ruleset that
// is not right; 401 no or unknown key; 413 too large; 415 not JSON; 429 too many (Retry-After); 503 busy or too slow.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIMITS, type CheckResult } from '@archboard/engine';
import { hostFor, type Key } from './keys.ts';
import { Limiter, type RateLimit } from './limit.ts';
import type { Run } from './runner.ts';

/** A diagram's own limit plus room for a ruleset of 100 rules. */
export const MAX_BODY = LIMITS.bytes + 192 * 1024;

export interface AppOptions {
  keys: Key[];
  rate: RateLimit;
  run: Run<{ ok: true; result: CheckResult } | { ok: false; errors: string[] }>;
  engine: string;
  log?: (line: Record<string, unknown>) => void;
  now?: () => number;
}

export function createApp(o: AppOptions) {
  const app = new Hono<{ Variables: { host: string } }>();
  const limiter = new Limiter(o.rate, o.now);
  const log = o.log ?? ((line) => console.log(JSON.stringify(line)));

  app.use('*', async (c, next) => {
    const t = Date.now();
    await next();
    log({ at: new Date(t).toISOString(), method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t, host: c.get('host') ?? null });
  });

  app.get('/v1/health', (c) => c.json({ ok: true, engine: o.engine }));

  app.post(
    '/v1/check',
    async (c, next) => {
      const host = hostFor(o.keys, c.req.header('authorization'));
      if (!host) return c.json({ error: 'unauthorized', message: 'Send "Authorization: Bearer <key>" with this host\'s key.' }, 401);
      c.set('host', host);
      const wait = limiter.take(host);
      if (wait) { c.header('Retry-After', String(wait)); return c.json({ error: 'rate-limited', message: `Too many checks: try again in ${wait} s.` }, 429); }
      if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'not-json', message: 'Send the body as application/json.' }, 415);
      await next();
    },
    bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: 'too-large', message: `The body is larger than ${Math.round(MAX_BODY / 1024)} KB.` }, 413) }),
    async (c) => {
      let body: unknown;
      try { body = await c.req.json(); } catch { return c.json({ error: 'bad-request', message: 'The body is not JSON.' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('diagram' in body) || !('ruleset' in body) || Object.keys(body).length !== 2) {
        return c.json({ error: 'bad-request', message: 'Send {"diagram": ..., "ruleset": ...} and nothing else.' }, 400);
      }
      const { diagram, ruleset } = body as { diagram: unknown; ruleset: unknown };
      const r = await o.run({ diagram, ruleset });
      if (!r.ok) return c.json({ error: r.reason === 'busy' ? 'busy' : 'unavailable', message: r.reason === 'busy' ? 'The checker is busy: try again shortly.' : r.reason === 'timeout' ? 'The check took too long and was stopped.' : 'The check failed to run.' }, 503);
      if (!r.value.ok) return c.json({ error: 'bad-ruleset', message: 'The ruleset is not valid.', errors: r.value.errors }, 400);
      return c.json({ ...r.value.result, engine: o.engine });
    },
  );

  app.notFound((c) => c.json({ error: 'not-found' }, 404));
  app.onError((_e, c) => c.json({ error: 'server-error' }, 500));
  return app;
}
