import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { checkDiagram, fromTemplate, serializeDiagram } from '@archboard/engine';
import { createApp, MAX_BODY } from './app.ts';
import { hostFor, parseKeys } from './keys.ts';
import { Limiter } from './limit.ts';
import { workerRunner } from './runner.ts';

const SECRET = 'labsite-secret-0123456789abcdef';
const RULES = {
  format: 'archboard-rules', version: 1,
  rules: [
    { id: 'lb', points: 2, text: 'Users reach the app through a load balancer', rule: { path: ['client', 'load-balancer', 'vm'] } },
    { id: 'db', points: 1, text: 'The database is not in a public subnet', rule: { placement: { role: 'relational-db', notIn: { kind: 'subnet', access: 'public' } } } },
  ],
};

function app(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  const lines: Record<string, unknown>[] = [];
  const a = createApp({
    keys: parseKeys(`labsite:${SECRET}`),
    rate: { burst: 100, perMinute: 100 },
    run: async (job) => { const j = job as { diagram: unknown; ruleset: unknown }; return { ok: true, value: checkDiagram(j.diagram, j.ruleset) }; },
    engine: '0.1.0',
    log: (l) => lines.push(l),
    ...over,
  });
  const post = (body: unknown, headers: Record<string, string> = {}) => a.request('/v1/check', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { a, post, lines };
}

describe('POST /v1/check', () => {
  it('scores a diagram with the editor\'s engine and stamps the engine version', async () => {
    const { post } = app();
    const r = await post({ diagram: JSON.parse(serializeDiagram(fromTemplate('three-tier'))), ruleset: RULES });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ valid: true, score: 3, max: 3, engine: '0.1.0', results: [{ id: 'lb', pass: true, points: 2 }, { id: 'db', pass: true, points: 1 }] });
  });

  it('a diagram that is not valid scores 0 with its errors; a bad ruleset is the host\'s mistake (400)', async () => {
    const { post } = app();
    const bad = await post({ diagram: { format: 'archboard', version: 1, nodes: [{ id: 'x' }] }, ruleset: RULES });
    expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({ valid: false, score: 0, max: 3 });
    const rs = await post({ diagram: fromTemplate('blank'), ruleset: { ...RULES, rules: [{ id: 'a', points: 1, text: 't', rule: { label: 'x' } }] } });
    expect(rs.status).toBe(400);
    expect(await rs.json()).toMatchObject({ error: 'bad-ruleset' });
  });

  it('refuses without the right key, without JSON, with other fields, and when too large', async () => {
    const { post, lines } = app();
    const body = { diagram: fromTemplate('blank'), ruleset: RULES };
    expect((await post(body, { authorization: '' })).status).toBe(401);
    expect((await post(body, { authorization: 'Bearer labsite-secret-0123456789abcdeX' })).status).toBe(401);
    expect((await post(body, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({ ...body, score: 100 })).status).toBe(400);
    expect((await post('{not json')).status).toBe(400);
    expect((await post({ diagram: 'x'.repeat(MAX_BODY), ruleset: RULES })).status).toBe(413);
    // The log has the host and the status, never the body.
    expect(lines.every((l) => !JSON.stringify(l).includes('diagram') && !JSON.stringify(l).includes(SECRET))).toBe(true);
    expect(lines.some((l) => l.host === 'labsite' && l.status === 415)).toBe(true);
  });

  it('limits each host to its rate, and says when to come back', async () => {
    let t = 0;
    const { post } = app({ rate: { burst: 2, perMinute: 60 }, now: () => t });
    const body = { diagram: fromTemplate('blank'), ruleset: RULES };
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const third = await post(body);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('1');
    t += 1000;
    expect((await post(body)).status).toBe(200);
  });

  it('a check that times out or the checker being busy is 503, not a score', async () => {
    const { post } = app({ run: async () => ({ ok: false, reason: 'timeout' }) });
    const r = await post({ diagram: fromTemplate('blank'), ruleset: RULES });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'unavailable' });
  });

  it('health needs no key; anything else is 404; there is no CORS', async () => {
    const { a } = app();
    expect(await (await a.request('/v1/health')).json()).toEqual({ ok: true, engine: '0.1.0' });
    expect((await a.request('/v1/other')).status).toBe(404);
    const pre = await a.request('/v1/check', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('keys and limits', () => {
  it('keys are name:secret with a long secret; a bearer token finds its host', () => {
    expect(() => parseKeys('labsite:short')).toThrow(/shorter/);
    expect(() => parseKeys(`Lab Site:${SECRET}`)).toThrow(/name:secret/);
    expect(() => parseKeys(`a:${SECRET},a:${SECRET}x`)).toThrow(/twice/);
    const keys = parseKeys(`labsite:${SECRET}, other:${SECRET}-2`);
    expect(hostFor(keys, `Bearer ${SECRET}-2`)).toBe('other');
    expect(hostFor(keys, `Basic ${SECRET}`)).toBeNull();
    expect(hostFor(keys, undefined)).toBeNull();
  });
  it('the bucket refills with time, per host', () => {
    let t = 0;
    const l = new Limiter({ burst: 1, perMinute: 6 }, () => t);
    expect([l.take('a'), l.take('b'), l.take('a')]).toEqual([0, 0, 10]);
    t = 10_000;
    expect(l.take('a')).toBe(0);
  });
});

describe('the worker runner', () => {
  // Plain JavaScript workers (eval), so the runner is tested without a build: one answers, one never does.
  const answer = () => new Worker("require('node:worker_threads').parentPort.once('message', (m) => require('node:worker_threads').parentPort.postMessage(m * 2));", { eval: true });
  const stuck = () => new Worker('while (true) {}', { eval: true });
  const limits = { timeoutMs: 400, parallel: 2, queue: 1, resources: { maxOldGenerationSizeMb: 32 } };

  it('returns the worker\'s answer', async () => {
    expect(await workerRunner<number>(answer, limits)(21)).toEqual({ ok: true, value: 42 });
  });
  it('stops a check that runs too long', async () => {
    const t = Date.now();
    expect(await workerRunner(stuck, limits)(1)).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('runs at most `parallel` at once, queues `queue` more, and turns the rest away', async () => {
    const run = workerRunner(stuck, limits);
    const all = await Promise.all([run(1), run(2), run(3), run(4)]);
    expect(all.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['timeout', 'timeout', 'timeout', 'busy']);
  });
});
