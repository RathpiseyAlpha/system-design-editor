// Every check runs in its own worker thread with a time limit and a memory limit (SPEC section 10): a request body is
// untrusted, and whatever it does, the worst it can do is fail its own check. A fresh worker per check keeps nothing from
// one host's request in memory for the next. At most `parallel` checks run at once; up to `queue` more wait their turn.
import { Worker, type ResourceLimits } from 'node:worker_threads';

export interface RunLimits { timeoutMs: number; parallel: number; queue: number; resources: ResourceLimits }
export const DEFAULT_RUN: RunLimits = {
  timeoutMs: 2000,
  parallel: 4,
  queue: 200,
  resources: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
};

export type RunOutcome<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'busy' | 'crashed' };
export type Run<T> = (job: unknown) => Promise<RunOutcome<T>>;

/** A runner that starts `makeWorker()` for each job, posts the job, and waits for one message back. */
export function workerRunner<T>(makeWorker: (resources: ResourceLimits) => Worker, limits: RunLimits = DEFAULT_RUN): Run<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  // A finished check hands its place straight to the next one waiting, so no new arrival can slip in between.
  const release = () => { const next = waiting.shift(); if (next) next(); else running--; };

  const once = (job: unknown) => new Promise<RunOutcome<T>>((resolve) => {
    const w = makeWorker(limits.resources);
    let settled = false;
    const done = (r: RunOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void w.terminate();
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), limits.timeoutMs);
    w.once('message', (value: T) => done({ ok: true, value }));
    w.once('error', () => done({ ok: false, reason: 'crashed' }));
    w.once('exit', () => done({ ok: false, reason: 'crashed' }));
    w.postMessage(job);
  });

  return async (job) => {
    if (running >= limits.parallel) {
      if (waiting.length >= limits.queue) return { ok: false, reason: 'busy' };
      await new Promise<void>((go) => waiting.push(go)); // woken with the place of a check that ended
    } else running++;
    try { return await once(job); } finally { release(); }
  };
}
