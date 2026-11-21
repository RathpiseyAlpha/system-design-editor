// Runs a simulation off the main thread (SPEC section 13.4): the same engine the checker runs in Node.
import { simulate, type Diagram } from '@archboard/engine';

self.onmessage = (e: MessageEvent<{ id: number; diagram: Diagram; scenario: unknown }>) => {
  try {
    self.postMessage({ id: e.data.id, ...simulate(e.data.diagram, e.data.scenario) });
  } catch (err) {
    self.postMessage({ id: e.data.id, ok: false, errors: [String((err as Error)?.message ?? err)] });
  }
};
