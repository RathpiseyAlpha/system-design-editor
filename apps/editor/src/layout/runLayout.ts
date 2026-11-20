// Ask the layout worker for an auto-layout. The worker is created on first use and kept for later runs.
import type { Diagram } from '@archboard/engine';

let worker: Worker | null = null;
let seq = 0;

export function runLayout(d: Diagram): Promise<Diagram> {
  worker ??= new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<{ id: number; ok: boolean; diagram?: Diagram; error?: string }>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (e.data.ok && e.data.diagram) resolve(e.data.diagram);
      else reject(new Error(e.data.error ?? 'The layout failed.'));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ id, diagram: d });
  });
}
