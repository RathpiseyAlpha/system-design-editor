// The checker service's entry (built to dist/server.js by build.mjs). Settings come from the environment:
//   ARCHBOARD_KEYS   name:secret pairs, comma separated (required; see keys.ts)
//   PORT             default 8787        HOST  default 0.0.0.0 (inside its container; publish it on the Docker network only)
//   ARCHBOARD_RATE   checks a minute per host key, also the burst (default 120)
//   ARCHBOARD_TIMEOUT_MS  per check (default 2000)        ARCHBOARD_PARALLEL  checks at once (default 4)
import { Worker } from 'node:worker_threads';
import { serve } from '@hono/node-server';
import engine from '@archboard/engine/package.json' with { type: 'json' };
import { createApp } from './app.ts';
import { parseKeys } from './keys.ts';
import { DEFAULT_RUN, workerRunner } from './runner.ts';

const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v ?? d);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`a setting is out of range: ${v} (from ${min} to ${max})`);
  return n;
};

const keys = parseKeys(process.env.ARCHBOARD_KEYS);
if (!keys.length) {
  console.error('ARCHBOARD_KEYS is empty: give each host a key, for example ARCHBOARD_KEYS="labsite:<a long random secret>".');
  process.exit(1);
}
const rate = num(process.env.ARCHBOARD_RATE, 120, 1, 100_000);
const run = workerRunner(
  (resourceLimits) => new Worker(new URL('./worker.js', import.meta.url), { resourceLimits }),
  { ...DEFAULT_RUN, timeoutMs: num(process.env.ARCHBOARD_TIMEOUT_MS, DEFAULT_RUN.timeoutMs, 1, 60_000), parallel: num(process.env.ARCHBOARD_PARALLEL, DEFAULT_RUN.parallel, 1, 64) },
);
const app = createApp({ keys, rate: { burst: rate, perMinute: rate }, run: run as never, engine: engine.version });

const port = num(process.env.PORT, 8787, 1, 65535);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'checker listening', port: info.port, engine: engine.version, hosts: keys.map((k) => k.name) }));
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
