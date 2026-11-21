// The simulation engine (SPEC section 13, M4): a teaching model with indicative numbers. Rate-based, one tick per simulated
// second, reading roles, zones and connections (never products), so every icon pack gives the same result. What each step
// means is fixed in SPEC section 12, decision 39; this file follows it point by point (the numbers in the comments).
// Deterministic: blocks and connections in a fixed order, no clock, no Math.random, values rounded each tick.
import { z } from 'zod';
import { isRole, roleInfo } from './roles.ts';
import type { DEdge, DNode, Diagram, DZone } from './format.ts';

export const SIM_ENGINE = 'sim-1';
export const SCENARIO_FORMAT = 'archboard-scenario';
export const SCENARIO_VERSION = 1;
export const SCENARIO_LIMITS = { duration: 3600, events: 50, load: 20, points: 50 } as const;

// ---------------------------------------------------------------- role defaults (section 13.3)

export interface BlockDefaults { instances: number; capacity: number; latency: number; hitRate?: number; queueSize?: number; fn?: boolean }
const d = (instances: number, capacity: number, latency: number, extra: Partial<BlockDefaults> = {}): BlockDefaults => ({ instances, capacity, latency, ...extra });
const QUEUE = d(1, 10_000, 5, { queueSize: 100_000 });
const OTHER = d(1, 1000, 5);
const COMPUTE = d(2, 500, 25);
export const ROLE_DEFAULTS: Record<string, BlockDefaults> = {
  'load-balancer': d(1, 20_000, 1), dns: d(1, 50_000, 1), cdn: d(1, 50_000, 5, { hitRate: 0.6 }), 'api-gateway': d(1, 10_000, 5), waf: d(1, 20_000, 2), nat: d(1, 10_000, 1),
  service: COMPUTE, 'web-app': COMPUTE, containers: COMPUTE, kubernetes: COMPUTE, job: COMPUTE, autoscaling: COMPUTE, vm: d(1, 300, 25), custom: d(1, 500, 25),
  function: d(0, 10, 30, { fn: true }),
  'relational-db': d(1, 1000, 5), 'nosql-db': d(1, 5000, 3), search: d(1, 500, 20), warehouse: d(1, 50, 500), cache: d(1, 20_000, 1, { hitRate: 0.8 }),
  'object-storage': d(1, 5000, 20), 'block-storage': d(1, 2000, 2), 'file-storage': d(1, 2000, 2),
  queue: QUEUE, pubsub: QUEUE, stream: QUEUE,
  monitoring: OTHER, logs: OTHER, identity: OTHER, secrets: OTHER, registry: OTHER,
};
export const defaultsFor = (role: string): BlockDefaults => ROLE_DEFAULTS[role] ?? d(1, 500, 25);
const isSource = (role: string) => roleInfo(role).category === 'client';
const isQueue = (role: string) => roleInfo(role).category === 'messaging';
const isDatabase = (role: string) => roleInfo(role).category === 'database' && role !== 'cache';

// ---------------------------------------------------------------- scenario file (section 13.2)

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const eventSchema = z.object({
  at: z.number().min(0).max(SCENARIO_LIMITS.duration),
  type: z.enum(['fail', 'recover', 'slow', 'hit-rate', 'backlog', 'cut']),
  node: id.optional(), zone: id.optional(), edge: id.optional(), role: z.string().refine(isRole, { message: 'is not a role in the catalog' }).optional(),
  latency: z.number().min(0.01).max(100).optional(),
  capacity: z.number().min(0).max(100).optional(),
  value: z.number().min(0).max(1).optional(),
  consumers: z.number().min(0).max(100).optional(),
}).strict().superRefine((e, ctx) => {
  const targets = [e.node, e.zone, e.edge, e.role].filter((x) => x !== undefined).length;
  if (targets !== 1) ctx.addIssue({ code: 'custom', message: 'name exactly one target: node, zone, edge or role' });
  const need = (ok: boolean, msg: string) => { if (!ok) ctx.addIssue({ code: 'custom', message: msg }); };
  if (e.type === 'cut') need(e.edge !== undefined, 'cut takes an edge');
  if (e.type === 'slow') need(e.latency !== undefined || e.capacity !== undefined, 'slow takes a latency or capacity factor');
  if (e.type === 'hit-rate') need(e.value !== undefined && e.edge === undefined && e.zone === undefined, 'hit-rate takes a value and a node or role');
  if (e.type === 'backlog') need(e.consumers !== undefined && e.edge === undefined && e.zone === undefined, 'backlog takes a consumers factor and a node or role');
  if (e.type === 'fail' || e.type === 'slow') need(e.edge === undefined, `${e.type} takes a node, zone or role (use cut for a connection)`);
});
export const scenarioSchema = z.object({
  format: z.literal(SCENARIO_FORMAT),
  version: z.literal(SCENARIO_VERSION),
  title: z.string().max(120).default('Scenario'),
  for: z.object({ title: z.string().max(80).optional(), hash: z.string().max(80).optional() }).strict().optional(),
  duration: z.number().int().min(1).max(SCENARIO_LIMITS.duration).default(300),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(1),
  load: z.array(z.object({ from: id, rps: z.array(z.tuple([z.number().min(0).max(SCENARIO_LIMITS.duration), z.number().min(0).max(1_000_000)])).min(1).max(SCENARIO_LIMITS.points) }).strict()).min(1).max(SCENARIO_LIMITS.load),
  events: z.array(eventSchema).max(SCENARIO_LIMITS.events).default([]),
  expect: z.object({ errorRate: z.number().min(0).max(1).optional(), p95: z.number().min(1).max(600_000).optional() }).strict().default({}),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export type SimEvent = Scenario['events'][number];

/** Read a scenario and check every id it names against the diagram. */
export function parseScenario(data: unknown, dgm: Diagram): { ok: true; scenario: Scenario } | { ok: false; errors: string[] } {
  const r = scenarioSchema.safeParse(data);
  if (!r.success) return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`) };
  const nodes = new Set(dgm.nodes.map((n) => n.id)), zones = new Set(dgm.zones.map((z) => z.id)), edges = new Set(dgm.edges.map((e) => e.id));
  const errors: string[] = [];
  r.data.load.forEach((l, i) => { if (!nodes.has(l.from)) errors.push(`load.${i}.from: no block has the id "${l.from}"`); });
  r.data.events.forEach((e, i) => {
    if (e.node !== undefined && !nodes.has(e.node)) errors.push(`events.${i}.node: no block has the id "${e.node}"`);
    if (e.zone !== undefined && !zones.has(e.zone)) errors.push(`events.${i}.zone: no zone has the id "${e.zone}"`);
    if (e.edge !== undefined && !edges.has(e.edge)) errors.push(`events.${i}.edge: no connection has the id "${e.edge}"`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, scenario: r.data };
}

// ---------------------------------------------------------------- results

export interface NodeTick { arrival: number; accepted: number; util: number; instances: number; latency: number; failed: boolean; queue?: number }
export interface Tick { t: number; offered: number; served: number; errorRate: number; p95: number; nodes: Record<string, NodeTick>; edges: Record<string, number> }
export type Verdict = 'handles' | 'breaks';
export interface SimSummary {
  offered: number; served: number; errorRate: number; p95: number;
  maxQueue: { node: string; length: number } | null; growingQueues: string[];
  usersServed: boolean; verdict: Verdict;
  bottleneck: { node: string; peakUtil: number } | null;
  spofs: { kind: 'node' | 'zone'; id: string }[];
  hints: string[];
}
export interface SimResult { engine: string; ticks: Tick[]; summary: SimSummary }

// ---------------------------------------------------------------- the model

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const ERROR_RATE = 0.01;
export const P95_MS = 1000;
const SCALE_UP_S = 30, SCALE_DOWN_S = 60, WARMUP_S = 60, COLD_START_MS = 300, FN_MAX = 1000;

interface Params { instances: number; capacity: number; latency: number; hitRate: number; queueSize: number; fn: boolean; autoscale: { min: number; max: number; threshold: number; warmup: number } | null }
interface NodeState { failed: boolean; latF: number; capF: number; hitRate: number; consumers: number; instances: number; pending: { at: number; add: number }[]; above: number | null; below: number | null; queue: number; ratio: number }

class Model {
  readonly nodes: DNode[];
  readonly edges: DEdge[];
  readonly order: DNode[];
  readonly params = new Map<string, Params>();
  readonly out = new Map<string, DEdge[]>();
  readonly around = new Map<string, string[]>();
  readonly node = new Map<string, DNode>();

  constructor(readonly d: Diagram) {
    this.nodes = [...d.nodes].sort(byId);
    this.edges = [...d.edges].sort(byId);
    const zones = new Map<string, DZone>(d.zones.map((z) => [z.id, z]));
    for (const n of this.nodes) {
      this.node.set(n.id, n);
      const def = defaultsFor(n.role), s = n.sim ?? {};
      const as = s.autoscale ? { min: s.autoscale.min, max: Math.max(s.autoscale.min, s.autoscale.max), threshold: s.autoscale.threshold, warmup: s.autoscale.warmup ?? WARMUP_S } : null;
      let inst = s.instances ?? def.instances;
      if (as) inst = Math.min(as.max, Math.max(as.min, inst));
      this.params.set(n.id, { instances: inst, capacity: s.capacity ?? def.capacity, latency: s.latency ?? def.latency, hitRate: s.hitRate ?? def.hitRate ?? 0, queueSize: s.queueSize ?? def.queueSize ?? 0, fn: !!def.fn, autoscale: as });
      const chain: string[] = [];
      for (let z = n.zone; z !== undefined && zones.has(z) && chain.length < 40 && !chain.includes(z); z = zones.get(z)!.parent) chain.push(z);
      this.around.set(n.id, chain);
    }
    for (const e of this.edges) if (e.kind !== 'data' && this.node.has(e.from) && this.node.has(e.to)) this.out.set(e.from, [...(this.out.get(e.from) ?? []), e]);
    this.order = this.flowOrder();
  }

  /** (3) Flow order: topological over request and async connections (and a queue's outgoing ones), id order breaking ties. */
  private flowOrder(): DNode[] {
    const indeg = new Map(this.nodes.map((n) => [n.id, 0]));
    for (const es of this.out.values()) for (const e of es) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    const ready = this.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
    const order: DNode[] = [];
    while (ready.length) {
      ready.sort();
      const idn = ready.shift()!;
      order.push(this.node.get(idn)!);
      for (const e of this.out.get(idn) ?? []) {
        const k = indeg.get(e.to)! - 1;
        indeg.set(e.to, k);
        if (k === 0) ready.push(e.to);
      }
    }
    if (order.length < this.nodes.length) {
      const stuck = this.nodes.filter((n) => !order.includes(n)).map((n) => `"${n.label}"`);
      throw new CycleError(`These blocks call each other in a circle, so requests never end: ${stuck.slice(0, 6).join(', ')}${stuck.length > 6 ? ' and more' : ''}. Remove one connection of the circle, or make it a data connection.`);
    }
    return order;
  }

  freshState(): Map<string, NodeState> {
    return new Map(this.nodes.map((n) => {
      const p = this.params.get(n.id)!;
      return [n.id, { failed: false, latF: 1, capF: 1, hitRate: p.hitRate, consumers: 1, instances: p.instances, pending: [], above: null, below: null, queue: 0, ratio: 1 }];
    }));
  }

  /** One second of the model. `failedZones` and `cut` are the scenario's state; `st` is changed in place (queues, ratios). */
  tick(t: number, offered: Map<string, number>, st: Map<string, NodeState>, failedZones: Set<string>, cut: Set<string>, autoscale: boolean): Tick {
    const down = (idn: string) => st.get(idn)!.failed || this.around.get(idn)!.some((z) => failedZones.has(z));
    const arrival = new Map(this.nodes.map((n) => [n.id, 0]));
    const accepted = new Map<string, number>(), ratio = new Map<string, number>(), cap = new Map<string, number>(), coldStart = new Set<string>();
    const edgeRate: Record<string, number> = {};
    const live = (e: DEdge) => !cut.has(e.id) && !down(e.to);
    const send = (e: DEdge, rate: number) => { arrival.set(e.to, arrival.get(e.to)! + rate); edgeRate[e.id] = (edgeRate[e.id] ?? 0) + rate; };
    const hitOf = new Map<string, { cache: DEdge; dbs: DEdge[]; h: number }>();

    // (2) The offered load enters at the sources.
    for (const [src, rps] of offered) arrival.set(src, arrival.get(src)! + rps);

    for (const n of this.order) {
      const s = st.get(n.id)!, p = this.params.get(n.id)!, A = arrival.get(n.id)!;
      const failed = down(n.id);
      if (isSource(n.role)) {
        accepted.set(n.id, failed ? 0 : A); ratio.set(n.id, failed ? 0 : 1); cap.set(n.id, Infinity);
      } else {
        if (p.fn && !failed) {
          const want = Math.min(FN_MAX, Math.ceil(A / (p.capacity * s.capF || 1)));
          if (want > s.instances) coldStart.add(n.id);
          s.instances = want;
        }
        const C = failed ? 0 : s.instances * p.capacity * s.capF;
        cap.set(n.id, C);
        if (isQueue(n.role)) {
          // (7) A queue drains to its consumers first, then takes new messages up to its rate and free space.
          const consumers = (this.out.get(n.id) ?? []).filter(live);
          const drainCap = failed ? 0 : consumers.reduce((sum, e) => { const cp = this.params.get(e.to)!, cs = st.get(e.to)!; return sum + cs.instances * cp.capacity * cs.capF; }, 0) * s.consumers;
          const drained = Math.min(s.queue, drainCap);
          s.queue -= drained;
          for (const e of consumers) send(e, drained / consumers.length);
          const acc = Math.min(A, C, Math.max(0, p.queueSize - s.queue));
          s.queue += acc;
          accepted.set(n.id, acc); ratio.set(n.id, A > 0 ? acc / A : failed ? 0 : 1);
          continue;
        }
        const acc = Math.min(A, C);
        accepted.set(n.id, acc); ratio.set(n.id, A > 0 ? acc / A : failed ? 0 : 1);
      }
      // (4) Only what a block accepts calls onward.
      const acc = accepted.get(n.id)!;
      const deps = this.out.get(n.id) ?? [];
      if (!acc || !deps.length) continue;
      if (n.role === 'load-balancer') {
        // (5) A load balancer splits across healthy targets: by share if set, else evenly.
        const healthy = deps.filter(live);
        const w = weights(healthy);
        healthy.forEach((e, i) => send(e, acc * w[i]!));
        continue;
      }
      const passOn = n.role === 'cdn' ? acc * (1 - s.hitRate) : acc;
      // (6) Cache-aside: a cache and a database called by the same block; the database gets the misses.
      // The pair is found whether or not the cache is up: a cache that is down hits nothing, so every request is a miss.
      const cacheEdge = deps.find((e) => this.node.get(e.to)!.role === 'cache');
      const dbEdges = cacheEdge ? deps.filter((e) => isDatabase(this.node.get(e.to)!.role)) : [];
      const h = cacheEdge && dbEdges.length && live(cacheEdge) ? st.get(cacheEdge.to)!.hitRate * st.get(cacheEdge.to)!.ratio : 0;
      if (cacheEdge && dbEdges.length) hitOf.set(n.id, { cache: cacheEdge, dbs: dbEdges, h });
      for (const e of deps) {
        if (!live(e)) continue;
        const share = e.sim?.share ?? 1;
        send(e, passOn * share * (dbEdges.includes(e) ? 1 - h : 1));
      }
    }

    // (9, 10) Served share and chain latency, callees first.
    const served = new Map<string, number>(), chain = new Map<string, number>(), lat = new Map<string, number>();
    for (const n of [...this.order].reverse()) {
      const s = st.get(n.id)!, p = this.params.get(n.id)!;
      const C = cap.get(n.id)!, A = arrival.get(n.id)!;
      const util = C === Infinity ? 0 : C > 0 ? A / C : A > 0 ? 1 : 0;
      const L = isSource(n.role) ? 0 : (p.latency * s.latF) / (1 - Math.min(util, 0.95)) + (coldStart.has(n.id) ? COLD_START_MS : 0);
      lat.set(n.id, L);
      const deps = this.out.get(n.id) ?? [];
      const call = (e: DEdge) => (live(e) ? ratio.get(e.to)! * served.get(e.to)! : 0);
      const time = (e: DEdge) => (e.sim?.latency ?? 0) + chain.get(e.to)!;
      if (isQueue(n.role)) { served.set(n.id, 1); chain.set(n.id, L); continue; }
      if (n.role === 'load-balancer') {
        const healthy = deps.filter(live), w = weights(healthy);
        served.set(n.id, healthy.reduce((sum, e, i) => sum + w[i]! * call(e), 0));
        chain.set(n.id, L + healthy.reduce((sum, e, i) => sum + w[i]! * time(e), 0));
        continue;
      }
      const ca = hitOf.get(n.id);
      let sv = 1, tm = L;
      for (const e of deps) {
        if (ca && ca.dbs.includes(e)) continue;
        if (ca && e === ca.cache) {
          // A cache that rejects is a miss, not an error: hit + miss × the databases.
          const dbs = ca.dbs.reduce((x, db) => x * call(db), 1);
          sv *= ca.h + (1 - ca.h) * dbs;
          tm += time(e) + (1 - ca.h) * ca.dbs.reduce((x, db) => x + time(db), 0);
          continue;
        }
        sv *= call(e);
        tm += this.node.get(e.to) && isQueue(this.node.get(e.to)!.role) ? (e.sim?.latency ?? 0) + lat.get(e.to)! : time(e);
      }
      if (n.role === 'cdn') { sv = s.hitRate + (1 - s.hitRate) * sv; tm = L + (1 - s.hitRate) * (tm - L); }
      if (isSource(n.role) && !deps.length) sv = 0;
      served.set(n.id, sv);
      chain.set(n.id, tm);
    }

    // Totals for the tick: what the sources offered and what was served; p95 is twice the slowest served chain.
    let off = 0, ok = 0, slow = 0;
    for (const [src, rps] of offered) {
      const sv = down(src) ? 0 : served.get(src)!;
      off += rps; ok += rps * sv;
      if (rps > 0 && sv > 0) slow = Math.max(slow, chain.get(src)!);
    }
    const nodes: Record<string, NodeTick> = {};
    for (const n of this.nodes) {
      const s = st.get(n.id)!, C = cap.get(n.id)!, A = arrival.get(n.id)!;
      s.ratio = ratio.get(n.id) ?? 1;
      s.queue = r3(s.queue);
      nodes[n.id] = {
        arrival: r3(A), accepted: r3(accepted.get(n.id) ?? 0), util: r3(C === Infinity ? 0 : C > 0 ? A / C : A > 0 ? 1 : 0),
        instances: isSource(n.role) ? 0 : s.instances, latency: r3(lat.get(n.id) ?? 0), failed: down(n.id),
        ...(isQueue(n.role) ? { queue: s.queue } : {}),
      };
      if (autoscale) this.scale(t, n, s, A);
    }
    for (const k of Object.keys(edgeRate)) edgeRate[k] = r3(edgeRate[k]!);
    return { t, offered: r3(off), served: r3(ok), errorRate: r3(off > 0 ? 1 - ok / off : 0), p95: r3(2 * slow), nodes, edges: edgeRate };
  }

  /** (11) Autoscaling after this tick's load: up after 30 s over the threshold (live after the warm-up), down after 60 s under half. */
  private scale(t: number, n: DNode, s: NodeState, A: number) {
    const p = this.params.get(n.id)!, as = p.autoscale;
    if (!as || p.fn) return;
    const C = s.instances * p.capacity * s.capF, util = C > 0 ? A / C : A > 0 ? Infinity : 0;
    const need = Math.ceil(A / (p.capacity * s.capF * as.threshold || 1));
    if (util > as.threshold) {
      s.below = null;
      s.above ??= t;
      if (t - s.above + 1 >= SCALE_UP_S) {
        const coming = s.pending.reduce((x, q) => x + q.add, 0);
        const add = Math.min(as.max, need) - s.instances - coming;
        if (add > 0) s.pending.push({ at: t + as.warmup, add });
        s.above = null;
      }
    } else if (util < as.threshold / 2) {
      s.above = null;
      s.below ??= t;
      if (t - s.below + 1 >= SCALE_DOWN_S) { s.instances = Math.max(as.min, Math.min(s.instances, need)); s.below = null; }
    } else { s.above = null; s.below = null; }
  }
}

class CycleError extends Error {}

/** Weights for a load balancer's healthy targets: their shares, normalised, or even. */
function weights(es: DEdge[]): number[] {
  if (!es.length) return [];
  const shares = es.map((e) => e.sim?.share);
  if (shares.every((x) => x !== undefined)) {
    const sum = shares.reduce((a, b) => a! + b!, 0)!;
    if (sum > 0) return shares.map((x) => x! / sum);
  }
  return es.map(() => 1 / es.length);
}

/** The value of a load series at time t: the last point at or before t (a step), 0 before the first. */
function loadAt(points: [number, number][], t: number): number {
  let v = 0;
  for (const [at, rps] of [...points].sort((a, b) => a[0] - b[0])) if (at <= t) v = rps;
  return v;
}

function applyEvent(m: Model, e: SimEvent, st: Map<string, NodeState>, failedZones: Set<string>, cut: Set<string>) {
  const targets = e.node !== undefined ? [e.node] : e.role !== undefined ? m.nodes.filter((n) => n.role === e.role).map((n) => n.id) : [];
  const each = (f: (s: NodeState, idn: string) => void) => targets.forEach((idn) => { const s = st.get(idn); if (s) f(s, idn); });
  switch (e.type) {
    case 'fail': each((s) => { s.failed = true; }); if (e.zone !== undefined) failedZones.add(e.zone); break;
    case 'recover':
      each((s) => { s.failed = false; s.latF = 1; s.capF = 1; });
      if (e.zone !== undefined) failedZones.delete(e.zone);
      if (e.edge !== undefined) cut.delete(e.edge);
      break;
    case 'slow': each((s) => { s.latF = e.latency ?? 1; s.capF = e.capacity ?? 1; }); break;
    case 'hit-rate': each((s) => { s.hitRate = e.value!; }); break;
    case 'backlog': each((s) => { s.consumers = e.consumers!; }); break;
    case 'cut': cut.add(e.edge!); break;
  }
}

/** Run a scenario on a diagram. Untrusted input in, a result or the reasons it cannot run out. */
export function simulate(dgm: Diagram, scenarioData: unknown): { ok: true; result: SimResult } | { ok: false; errors: string[] } {
  const sc = parseScenario(scenarioData, dgm);
  if (!sc.ok) return sc;
  let m: Model;
  try { m = new Model(dgm); } catch (e) { if (e instanceof CycleError) return { ok: false, errors: [e.message] }; throw e; }
  const s = sc.scenario;
  const st = m.freshState(), failedZones = new Set<string>(), cut = new Set<string>();
  const events = [...s.events].map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i);
  const ticks: Tick[] = [];
  let next = 0;
  for (let t = 0; t < s.duration; t++) {
    while (next < events.length && events[next]!.e.at <= t) applyEvent(m, events[next++]!.e, st, failedZones, cut);
    for (const ns of st.values()) {
      const live = ns.pending.filter((q) => q.at <= t);
      if (live.length) { ns.instances += live.reduce((x, q) => x + q.add, 0); ns.pending = ns.pending.filter((q) => q.at > t); }
    }
    const offered = new Map<string, number>();
    for (const l of [...s.load].sort((a, b) => (a.from < b.from ? -1 : 1))) offered.set(l.from, (offered.get(l.from) ?? 0) + loadAt(l.rps, t));
    ticks.push(m.tick(t, offered, st, failedZones, cut, true));
  }
  return { ok: true, result: { engine: SIM_ENGINE, ticks, summary: summarise(m, s, ticks) } };
}

function summarise(m: Model, s: Scenario, ticks: Tick[]): SimSummary {
  const maxErr = s.expect.errorRate ?? ERROR_RATE, maxP95 = s.expect.p95 ?? P95_MS;
  const offered = ticks.reduce((x, t) => x + t.offered, 0), served = ticks.reduce((x, t) => x + t.served, 0);
  const errorRate = r3(offered > 0 ? 1 - served / offered : 0);
  const p95s = ticks.filter((t) => t.served > 0).map((t) => t.p95).sort((a, b) => a - b);
  const p95 = p95s.length ? p95s[Math.min(p95s.length - 1, Math.ceil(p95s.length * 0.95) - 1)]! : 0;
  // Queues: the longest, and any that grew over the last 30 s.
  let maxQueue: SimSummary['maxQueue'] = null;
  const growing: string[] = [];
  const last = ticks[ticks.length - 1]!, before = ticks[Math.max(0, ticks.length - 31)]!;
  for (const n of m.nodes) {
    if (!isQueue(n.role)) continue;
    for (const t of ticks) { const q = t.nodes[n.id]!.queue ?? 0; if (q > (maxQueue?.length ?? 0)) maxQueue = { node: n.id, length: q }; }
    if (ticks.length > 30 && (last.nodes[n.id]!.queue ?? 0) > (before.nodes[n.id]!.queue ?? 0) + 1) growing.push(n.id);
  }
  // The bottleneck: the busiest block at or over 100 %.
  let bottleneck: SimSummary['bottleneck'] = null;
  for (const n of m.nodes) {
    if (isSource(n.role)) continue;
    const peak = Math.max(...ticks.map((t) => (t.nodes[n.id]!.failed ? 0 : t.nodes[n.id]!.util)));
    if (peak >= 1 && peak > (bottleneck?.peakUtil ?? 0)) bottleneck = { node: n.id, peakUtil: r3(peak) };
  }
  const spofs = singlePointsOfFailure(m, s, maxErr);
  const verdict: Verdict = errorRate < maxErr && p95 < maxP95 && !growing.length ? 'handles' : 'breaks';
  const label = (idn: string) => `"${m.node.get(idn)?.label ?? m.d.zones.find((z) => z.id === idn)?.label ?? idn}"`;
  const hints: string[] = [];
  if (bottleneck) {
    const role = m.node.get(bottleneck.node)!.role;
    hints.push(isDatabase(role)
      ? `${label(bottleneck.node)} is overloaded (${Math.round(bottleneck.peakUtil * 100)} %): put a cache in front of it, or add a read replica.`
      : `${label(bottleneck.node)} is overloaded (${Math.round(bottleneck.peakUtil * 100)} %): add instances or autoscaling.`);
  }
  for (const f of spofs.slice(0, 3)) hints.push(`${label(f.id)} is a single point of failure: when it fails, users are not served. Add a second ${f.kind === 'zone' ? 'zone' : 'instance behind a load balancer, or a standby'}.`);
  for (const q of growing) hints.push(`The queue ${label(q)} keeps growing: add consumers, or make them faster.`);
  if (s.events.some((e) => e.type === 'cut') && errorRate >= maxErr) hints.push('A cut connection stops traffic: give the requests a second path.');
  return { offered: r3(offered), served: r3(served), errorRate, p95, maxQueue, growingQueues: growing, usersServed: errorRate < maxErr, verdict, bottleneck, spofs, hints };
}

/** Blocks and zones whose failure alone breaks service at the starting load, while the design without it is fine. */
function singlePointsOfFailure(m: Model, s: Scenario, maxErr: number): SimSummary['spofs'] {
  const offered = new Map<string, number>();
  for (const l of s.load) offered.set(l.from, (offered.get(l.from) ?? 0) + loadAt(l.rps, 0));
  const once = (failNode: string | null, failZone: string | null) => {
    const st = m.freshState();
    if (failNode) st.get(failNode)!.failed = true;
    const t = m.tick(0, offered, st, new Set(failZone ? [failZone] : []), new Set(), false);
    return t.offered > 0 ? 1 - t.errorRate : 1;
  };
  if (once(null, null) < 1 - maxErr) return [];
  const out: SimSummary['spofs'] = [];
  for (const n of m.nodes) if (!isSource(n.role) && once(n.id, null) < 1 - maxErr) out.push({ kind: 'node', id: n.id });
  for (const z of [...m.d.zones].sort(byId)) if (once(null, z.id) < 1 - maxErr) out.push({ kind: 'zone', id: z.id });
  return out;
}
