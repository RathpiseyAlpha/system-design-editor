// Simulate mode's scenario presets (SPEC section 13.1, design page Screen E): each preset the user ticks becomes part of one
// scenario file (archboard-scenario v1) that the engine runs. Pure functions, so they are tested without a browser.
import { defaultsFor, roleInfo, type Diagram, type Scenario } from '@archboard/engine';

export interface ScenarioConfig {
  duration: number;
  steady: { on: boolean; rps: number };
  spike: { on: boolean; from: number; to: number; at: number };
  blockFail: { on: boolean; node: string; at: number };
  zoneDown: { on: boolean; zone: string; at: number };
  regionDown: { on: boolean; zone: string; at: number };
  slowDb: { on: boolean; node: string; latency: number; capacity: number; at: number };
  cacheMiss: { on: boolean; node: string; value: number; at: number };
  backlog: { on: boolean; node: string; consumers: number; at: number };
  linkCut: { on: boolean; edge: string; at: number };
  expect: { errorPct: number; p95: number };
}

export const DEFAULT_CONFIG: ScenarioConfig = {
  duration: 300,
  steady: { on: true, rps: 200 },
  spike: { on: false, from: 200, to: 2000, at: 60 },
  blockFail: { on: false, node: '', at: 120 },
  zoneDown: { on: false, zone: '', at: 120 },
  regionDown: { on: false, zone: '', at: 120 },
  slowDb: { on: false, node: '', latency: 4, capacity: 0.5, at: 120 },
  cacheMiss: { on: false, node: '', value: 0.2, at: 60 },
  backlog: { on: false, node: '', consumers: 0.3, at: 60 },
  linkCut: { on: false, edge: '', at: 120 },
  expect: { errorPct: 1, p95: 1000 },
};

/** What each preset can point at in this diagram. */
export function targets(d: Diagram) {
  const nodes = [...d.nodes].sort((a, b) => a.label.localeCompare(b.label));
  const cat = (role: string) => roleInfo(role).category;
  return {
    sources: d.nodes.filter((n) => cat(n.role) === 'client'),
    blocks: nodes.filter((n) => cat(n.role) !== 'client'),
    zones: d.zones.filter((z) => z.kind !== 'region'),
    regions: d.zones.filter((z) => z.kind === 'region'),
    databases: nodes.filter((n) => cat(n.role) === 'database' && n.role !== 'cache'),
    caches: nodes.filter((n) => n.role === 'cache' || defaultsFor(n.role).hitRate !== undefined),
    queues: nodes.filter((n) => cat(n.role) === 'messaging'),
    edges: d.edges.filter((e) => e.kind !== 'data'),
  };
}

/** m:ss for a second count. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** "1:30", "90" or "1:30.0" back to seconds; null when it is not a time. */
export function parseClock(v: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,4})\s*$/.exec(v);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

/** The ticked presets as one scenario, or what is missing (in words for the panel). */
export function buildScenario(c: ScenarioConfig, d: Diagram): { ok: true; scenario: Scenario } | { ok: false; errors: string[] } {
  const t = targets(d), errors: string[] = [];
  if (!t.sources.length) errors.push('Add a Users block (or another block that sends traffic): load enters there.');
  const rps: [number, number][] = c.spike.on ? [[0, c.spike.from], [c.spike.at, c.spike.to]] : [[0, c.steady.on ? c.steady.rps : 0]];
  if (!c.spike.on && !c.steady.on) errors.push('Tick Steady load or Traffic spike: without load there is nothing to simulate.');
  const events: Scenario['events'] = [];
  const need = (on: boolean, id: string, what: string) => { if (on && !id) errors.push(`Pick ${what}.`); return on && !!id; };
  if (need(c.blockFail.on, c.blockFail.node, 'the block that fails')) events.push({ at: c.blockFail.at, type: 'fail', node: c.blockFail.node });
  if (need(c.zoneDown.on, c.zoneDown.zone, 'the zone that goes down')) events.push({ at: c.zoneDown.at, type: 'fail', zone: c.zoneDown.zone });
  if (need(c.regionDown.on, c.regionDown.zone, 'the region that goes down')) events.push({ at: c.regionDown.at, type: 'fail', zone: c.regionDown.zone });
  if (need(c.slowDb.on, c.slowDb.node, 'the slow database')) events.push({ at: c.slowDb.at, type: 'slow', node: c.slowDb.node, latency: c.slowDb.latency, capacity: c.slowDb.capacity });
  if (need(c.cacheMiss.on, c.cacheMiss.node, 'the cache')) events.push({ at: c.cacheMiss.at, type: 'hit-rate', node: c.cacheMiss.node, value: c.cacheMiss.value });
  if (need(c.backlog.on, c.backlog.node, 'the queue')) events.push({ at: c.backlog.at, type: 'backlog', node: c.backlog.node, consumers: c.backlog.consumers });
  if (need(c.linkCut.on, c.linkCut.edge, 'the connection that is cut')) events.push({ at: c.linkCut.at, type: 'cut', edge: c.linkCut.edge });
  for (const e of events) if (e.at >= c.duration) errors.push(`An event at ${clock(e.at)} is after the end (${clock(c.duration)}).`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    scenario: {
      format: 'archboard-scenario', version: 1, title: title(c), for: { title: d.title.slice(0, 80) },
      duration: c.duration, seed: 1,
      load: t.sources.slice(0, 20).map((s) => ({ from: s.id, rps })),
      events,
      expect: { errorRate: c.expect.errorPct / 100, p95: c.expect.p95 },
    },
  };
}

function title(c: ScenarioConfig): string {
  const parts = [
    c.spike.on ? `Spike to ${c.spike.to} req/s` : c.steady.on ? `${c.steady.rps} req/s` : '',
    c.blockFail.on ? 'a block fails' : '', c.zoneDown.on ? 'a zone goes down' : '', c.regionDown.on ? 'a region goes down' : '',
    c.slowDb.on ? 'slow database' : '', c.cacheMiss.on ? 'cache misses' : '', c.backlog.on ? 'queue backlog' : '', c.linkCut.on ? 'a link is cut' : '',
  ].filter(Boolean);
  const s = parts.join(', then ');
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 120) || 'Scenario';
}

/** Zones down and connections cut at second t (for drawing): fail, cut and recover events up to t, in order. */
export function stateAt(s: Scenario, t: number): { zones: Set<string>; cut: Set<string> } {
  const zones = new Set<string>(), cut = new Set<string>();
  for (const e of [...s.events].sort((a, b) => a.at - b.at)) {
    if (e.at > t) break;
    if (e.type === 'fail' && e.zone) zones.add(e.zone);
    if (e.type === 'cut' && e.edge) cut.add(e.edge);
    if (e.type === 'recover') { if (e.zone) zones.delete(e.zone); if (e.edge) cut.delete(e.edge); }
  }
  return { zones, cut };
}

/** One line per event, for the timeline and "What happened". */
export function describeEvent(e: Scenario['events'][number], d: Diagram): string {
  const name = (idn?: string) => `"${d.nodes.find((n) => n.id === idn)?.label ?? d.zones.find((z) => z.id === idn)?.label ?? idn}"`;
  const edgeName = (idn?: string) => { const x = d.edges.find((e) => e.id === idn); return x ? `${name(x.from)} > ${name(x.to)}` : `"${idn}"`; };
  const who = e.node ? name(e.node) : e.zone ? name(e.zone) : e.edge ? edgeName(e.edge) : `every ${roleInfo(e.role ?? 'custom').name}`;
  switch (e.type) {
    case 'fail': return `${who} goes down.`;
    case 'recover': return `${who} is back.`;
    case 'slow': return `${who} slows down: ${e.latency ?? 1}× latency, ${Math.round((e.capacity ?? 1) * 100)}% capacity.`;
    case 'hit-rate': return `${who} hit rate drops to ${Math.round((e.value ?? 0) * 100)}%.`;
    case 'backlog': return `${who} consumers slow to ${Math.round((e.consumers ?? 1) * 100)}%.`;
    case 'cut': return `The connection ${who} is cut.`;
  }
}
