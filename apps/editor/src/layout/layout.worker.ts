// Runs ELK off the main thread. ELK (about 1.5 MB) is part of this worker's chunk only, loaded on the first Auto-layout.
import ELK from 'elkjs/lib/elk.bundled.js';
import type { Diagram } from '@archboard/engine';
import { autoLayout, type ElkLike } from './autoLayout.ts';

const elk = new ELK() as unknown as ElkLike;

self.onmessage = async (e: MessageEvent<{ id: number; diagram: Diagram }>) => {
  try {
    const diagram = await autoLayout(e.data.diagram, elk);
    self.postMessage({ id: e.data.id, ok: true, diagram });
  } catch (err) {
    self.postMessage({ id: e.data.id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
