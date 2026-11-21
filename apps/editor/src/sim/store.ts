// Simulate mode's own store (SPEC section 10: the simulation state lives apart from the diagram store, so a playing timeline
// re-renders only what shows it). The whole run is computed at once in a worker; playing moves `at` through its ticks.
import { create } from 'zustand';
import type { Diagram, Scenario, SimResult } from '@archboard/engine';
import { buildScenario, DEFAULT_CONFIG, type ScenarioConfig } from './scenario.ts';

export type Speed = 1 | 10 | 60;

interface SimState {
  config: ScenarioConfig;
  /** A scenario opened from a file, run as it is instead of the presets. */
  custom: Scenario | null;
  /** The scenario of the last run, and the diagram it ran on (an edit since makes the run out of date). */
  ran: { scenario: Scenario; diagram: Diagram } | null;
  result: SimResult | null;
  errors: string[] | null;
  running: boolean;
  at: number;
  playing: boolean;
  speed: Speed;
  setConfig: (patch: (c: ScenarioConfig) => ScenarioConfig) => void;
  setCustom: (s: Scenario | null) => void;
  run: (d: Diagram) => Promise<void>;
  seek: (t: number) => void;
  play: (on: boolean) => void;
  setSpeed: (s: Speed) => void;
  reset: () => void;
}

let worker: Worker | null = null;
let seq = 0;
function compute(diagram: Diagram, scenario: Scenario): Promise<{ ok: true; result: SimResult } | { ok: false; errors: string[] }> {
  worker ??= new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq, w = worker;
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      resolve(e.data.ok ? { ok: true, result: e.data.result } : { ok: false, errors: e.data.errors });
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', () => resolve({ ok: false, errors: ['The simulation could not start. Reload the page and try again.'] }), { once: true });
    w.postMessage({ id, diagram, scenario });
  });
}

export const useSim = create<SimState>()((set, get) => ({
  config: DEFAULT_CONFIG,
  custom: null,
  ran: null,
  result: null,
  errors: null,
  running: false,
  at: 0,
  playing: false,
  speed: 10,
  setConfig: (patch) => set((s) => ({ config: patch(s.config), errors: null })),
  setCustom: (custom) => set({ custom, errors: null }),
  run: async (d) => {
    const s = get();
    const built = s.custom ? { ok: true as const, scenario: s.custom } : buildScenario(s.config, d);
    if (!built.ok) { set({ errors: built.errors }); return; }
    set({ running: true, errors: null, playing: false });
    const r = await compute(d, built.scenario);
    if (!r.ok) { set({ running: false, errors: r.errors }); return; }
    set({ running: false, result: r.result, ran: { scenario: built.scenario, diagram: d }, at: 0, playing: true });
  },
  seek: (t) => {
    const n = get().result?.ticks.length ?? 0;
    set({ at: Math.max(0, Math.min(n - 1, Math.round(t))) });
  },
  play: (on) => {
    const s = get();
    if (on && s.result && s.at >= s.result.ticks.length - 1) set({ at: 0 });
    set({ playing: on && !!s.result });
  },
  setSpeed: (speed) => set({ speed }),
  reset: () => set({ at: 0, playing: false }),
}));
