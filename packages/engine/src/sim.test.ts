import { describe, expect, it } from 'vitest';
import { simulate, type SimResult } from './sim.ts';
import { emptyDiagram, type DEdge, type DNode, type Diagram, type DZone } from './format.ts';
import { fromTemplate } from './templates.ts';

const node = (id: string, role: string, extra: Partial<DNode> = {}): DNode => ({ id, role, label: id, x: 0, y: 0, ...extra });
const edge = (id: string, from: string, to: string, extra: Partial<DEdge> = {}): DEdge => ({ id, from, to, kind: 'request', ...extra });
const zone = (id: string, kind: DZone['kind'], extra: Partial<DZone> = {}): DZone => ({ id, kind, label: id, x: 0, y: 0, w: 4, h: 4, ...extra });
const dia = (nodes: DNode[], edges: DEdge[], zones: DZone[] = []): Diagram => ({ ...emptyDiagram(), nodes, edges, zones });
const scenario = (load: [number, number][], extra: object = {}, from = 'u') => ({ format: 'archboard-scenario', version: 1, duration: 60, load: [{ from, rps: load }], ...extra });

function run(d: Diagram, sc: unknown): SimResult {
  const r = simulate(d, sc);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.result;
}
const at = (r: SimResult, t: number) => r.ticks[t]!;

describe('the simulation engine (decision 39)', () => {
  it('is deterministic: the same diagram and scenario give the same numbers', () => {
    const d = fromTemplate('three-tier'), sc = scenario([[0, 200], [20, 900]], { duration: 120, events: [{ at: 40, type: 'fail', node: 'n3' }] }, 'n1');
    expect(JSON.stringify(run(d, sc))).toBe(JSON.stringify(run(d, sc)));
  });

  it('a load balancer splits evenly across healthy targets and skips a failed one', () => {
    const d = dia([node('u', 'client'), node('lb', 'load-balancer'), node('a', 'service'), node('b', 'service')], [edge('e1', 'u', 'lb'), edge('e2', 'lb', 'a'), edge('e3', 'lb', 'b')]);
    const r = run(d, scenario([[0, 400]], { events: [{ at: 10, type: 'fail', node: 'b' }] }));
    expect([at(r, 0).nodes.a!.arrival, at(r, 0).nodes.b!.arrival, at(r, 0).served]).toEqual([200, 200, 400]);
    expect([at(r, 10).nodes.a!.arrival, at(r, 10).nodes.b!.arrival, at(r, 10).served]).toEqual([400, 0, 400]); // a has 2 x 500
  });

  it('fan-out calls every dependency; a block over capacity rejects the excess, and only accepted requests call on', () => {
    const d = dia([node('u', 'client'), node('app', 'service'), node('db', 'relational-db'), node('logs', 'logs')], [edge('e1', 'u', 'app'), edge('e2', 'app', 'db'), edge('e3', 'app', 'logs')]);
    const t = at(run(d, scenario([[0, 1500]])), 0);
    expect([t.nodes.app!.accepted, t.nodes.db!.arrival, t.nodes.logs!.arrival]).toEqual([1000, 1000, 1000]); // app 2 x 500
    expect(t.served).toBe(1000);
    expect(t.errorRate).toBe(0.333);
  });

  it('cache-aside: the database gets only the misses; a failed cache sends everything to the database', () => {
    const d = dia([node('u', 'client'), node('app', 'service', { sim: { instances: 10 } }), node('c', 'cache'), node('db', 'relational-db', { sim: { capacity: 5000 } })],
      [edge('e1', 'u', 'app'), edge('e2', 'app', 'c'), edge('e3', 'app', 'db')]);
    const r = run(d, scenario([[0, 1000]], { events: [{ at: 5, type: 'fail', node: 'c' }] }));
    expect(at(r, 1).nodes.db!.arrival).toBe(200); // hit rate 0.8
    expect(at(r, 5).nodes.db!.arrival).toBe(1000);
    expect(at(r, 5).served).toBe(1000); // a cache that fails is a miss, not an error
  });

  it('a queue fills when consumers are slower, drains when they keep up, and rejects when full', () => {
    const d = dia([node('u', 'client'), node('api', 'service'), node('q', 'queue', { sim: { queueSize: 1000 } }), node('w', 'service', { sim: { instances: 1, capacity: 100 } })],
      [edge('e1', 'u', 'api'), edge('e2', 'api', 'q', { kind: 'async' }), edge('e3', 'q', 'w', { kind: 'async' })]);
    const slow = run(d, scenario([[0, 300]], { duration: 20 }));
    expect(at(slow, 3).nodes.q!.queue).toBeGreaterThan(at(slow, 2).nodes.q!.queue!);
    expect(at(slow, 19).nodes.q!.queue).toBe(1000);
    expect(at(slow, 19).errorRate).toBeGreaterThan(0); // full queue rejects
    const fast = run(d, scenario([[0, 80]], { duration: 20 }));
    expect(at(fast, 19).nodes.q!.queue).toBe(80);
    expect(fast.summary.growingQueues).toEqual([]);
  });

  it('autoscaling adds instances after 30 s over the threshold, live after the warm-up', () => {
    const d = dia([node('u', 'client'), node('app', 'service', { sim: { instances: 2, autoscale: { min: 2, max: 6, threshold: 0.7, warmup: 20 } } })], [edge('e1', 'u', 'app')]);
    const r = run(d, scenario([[0, 900]], { duration: 80 }));
    expect(at(r, 48).nodes.app!.instances).toBe(2);
    expect(at(r, 49).nodes.app!.instances).toBe(3); // ceil(900 / (500 x 0.7)) = 3, decided after 30 s over (t = 29), live 20 s later
    expect(at(r, 60).served).toBe(900);
  });

  it('a failed zone switches off the blocks in the zones nested in it', () => {
    const z = [zone('region', 'region'), zone('net', 'network', { parent: 'region' }), zone('sub', 'subnet', { parent: 'net' })];
    const d = dia([node('u', 'client'), node('app', 'service', { zone: 'sub' })], [edge('e1', 'u', 'app')], z);
    const r = run(d, scenario([[0, 100]], { events: [{ at: 5, type: 'fail', zone: 'region' }, { at: 8, type: 'recover', zone: 'region' }] }));
    expect([at(r, 4).served, at(r, 5).nodes.app!.failed, at(r, 5).served, at(r, 8).served]).toEqual([100, true, 0, 100]);
  });

  it('the 3-tier shop: handles its normal load, breaks at 1,500 req/s on its small VMs, and names the single points of failure', () => {
    const d = fromTemplate('three-tier');
    const calm = run(d, scenario([[0, 200]], { duration: 60 }, 'n1'));
    expect(calm.summary.verdict).toBe('handles');
    const peak = run(d, scenario([[0, 200], [10, 1500]], { duration: 60 }, 'n1'));
    expect(peak.summary.verdict).toBe('breaks');
    expect(peak.summary.bottleneck?.node).toBe('n3'); // app-1: a VM, 1 x 300 req/s, gets half of 1,500
    expect(peak.summary.spofs.map((s) => s.id)).toEqual(expect.arrayContaining(['n2', 'n5', 'z1']));
    expect(peak.summary.spofs.map((s) => s.id)).not.toContain('n3'); // two app servers behind the balancer
    expect(peak.summary.hints[0]).toMatch(/"app-1" is overloaded/);
  });

  it('refuses a cycle of requests, naming its blocks, and a scenario naming an unknown block', () => {
    const d = dia([node('u', 'client'), node('a', 'service'), node('b', 'service')], [edge('e1', 'u', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')]);
    expect(simulate(d, scenario([[0, 10]]))).toMatchObject({ ok: false, errors: [expect.stringMatching(/circle.*"a", "b"/)] });
    expect(simulate(fromTemplate('three-tier'), scenario([[0, 10]], {}, 'nope'))).toMatchObject({ ok: false, errors: [expect.stringContaining('"nope"')] });
    expect(simulate(fromTemplate('three-tier'), scenario([[0, 10]], { events: [{ at: 1, type: 'cut', node: 'n2' }] }, 'n1')).ok).toBe(false);
  });

  it('share: only that part of the requests makes the call, so its failure costs only that part', () => {
    const d = dia([node('u', 'client'), node('app', 'service'), node('db', 'relational-db'), node('an', 'service')],
      [edge('e1', 'u', 'app'), edge('e2', 'app', 'db'), edge('e3', 'app', 'an', { sim: { share: 0.1 } })]);
    const r = run(d, scenario([[0, 100]], { events: [{ at: 5, type: 'fail', node: 'an' }] }));
    expect([at(r, 0).nodes.an!.arrival, at(r, 0).served, at(r, 5).served]).toEqual([10, 100, 90]);
  });

  it('load enters only at a client-category block', () => {
    expect(simulate(fromTemplate('three-tier'), scenario([[0, 10]], {}, 'n3'))).toMatchObject({ ok: false, errors: [expect.stringContaining('"app-1" is a Virtual machine block')] });
  });

  it('cut and recover a connection: behind a load balancer it is skipped, on a direct call it fails', () => {
    const d = dia([node('u', 'client'), node('lb', 'load-balancer'), node('a', 'service'), node('b', 'service'), node('db', 'relational-db')],
      [edge('e1', 'u', 'lb'), edge('e2', 'lb', 'a'), edge('e3', 'lb', 'b'), edge('e4', 'a', 'db'), edge('e5', 'b', 'db')]);
    const r = run(d, scenario([[0, 400]], { events: [{ at: 5, type: 'cut', edge: 'e3' }, { at: 10, type: 'cut', edge: 'e4' }, { at: 15, type: 'recover', edge: 'e4' }, { at: 15, type: 'recover', edge: 'e3' }] }));
    expect([at(r, 5).nodes.a!.arrival, at(r, 5).served]).toEqual([400, 400]);
    expect(at(r, 10).served).toBe(0); // all traffic goes to a, whose call to the database is cut
    expect([at(r, 15).nodes.b!.arrival, at(r, 15).served]).toEqual([200, 400]);
  });

  it('slow multiplies latency and capacity; hit-rate changes a cache; backlog slows consumers', () => {
    const d = dia([node('u', 'client'), node('app', 'service', { sim: { instances: 10 } }), node('c', 'cache'), node('db', 'relational-db', { sim: { capacity: 5000 } })],
      [edge('e1', 'u', 'app'), edge('e2', 'app', 'c'), edge('e3', 'app', 'db')]);
    const r = run(d, scenario([[0, 1000]], { events: [{ at: 5, type: 'hit-rate', node: 'c', value: 0.5 }, { at: 10, type: 'slow', role: 'relational-db', latency: 4, capacity: 0.1 }] }));
    expect([at(r, 6).nodes.db!.arrival, at(r, 6).served]).toEqual([500, 1000]);
    expect(at(r, 10).nodes.db!.latency).toBeGreaterThan(at(r, 9).nodes.db!.latency * 3.9);
    expect(at(r, 10).served).toBe(1000 - 500 + 500 * (500 / 500)); // capacity 5,000 x 0.1 = 500: just enough
    const q = dia([node('u', 'client'), node('api', 'service'), node('q', 'queue'), node('w', 'service', { sim: { instances: 1, capacity: 100 } })],
      [edge('e1', 'u', 'api'), edge('e2', 'api', 'q', { kind: 'async' }), edge('e3', 'q', 'w', { kind: 'async' })]);
    const b = run(q, scenario([[0, 80]], { duration: 40, events: [{ at: 0, type: 'backlog', node: 'q', consumers: 0.5 }] }));
    expect(b.summary.growingQueues).toEqual(['q']); // 80 in, 50 out
  });

  it('autoscaling removes instances after 60 s under half the threshold, never below min', () => {
    const d = dia([node('u', 'client'), node('app', 'service', { sim: { instances: 6, autoscale: { min: 2, max: 6, threshold: 0.7, warmup: 0 } } })], [edge('e1', 'u', 'app')]);
    const r = run(d, scenario([[0, 100]], { duration: 70 }));
    expect([at(r, 58).nodes.app!.instances, at(r, 60).nodes.app!.instances]).toEqual([6, 2]);
  });

  it('a CDN answers its hit rate itself; a function follows demand, with a cold start when it grows', () => {
    const d = dia([node('u', 'client'), node('cdn', 'cdn'), node('fn', 'function'), node('db', 'nosql-db')], [edge('e1', 'u', 'cdn'), edge('e2', 'cdn', 'fn'), edge('e3', 'fn', 'db')]);
    const r = run(d, scenario([[0, 1000], [10, 2000]]));
    expect([at(r, 0).nodes.fn!.arrival, at(r, 0).nodes.fn!.instances]).toEqual([400, 40]);
    expect(at(r, 10).nodes.fn!.instances).toBe(80);
    expect(at(r, 10).nodes.fn!.latency - at(r, 11).nodes.fn!.latency).toBeCloseTo(300, 0);
    expect(at(r, 11).served).toBe(2000);
  });

  it('50 blocks over 300 s run in well under a second', () => {
    const nodes = [node('u', 'client'), node('lb', 'load-balancer')], edges = [edge('e0', 'u', 'lb')];
    for (let i = 0; i < 16; i++) {
      nodes.push(node(`s${i}`, 'service'), node(`c${i}`, 'cache'), node(`d${i}`, 'relational-db'));
      edges.push(edge(`a${i}`, 'lb', `s${i}`), edge(`b${i}`, `s${i}`, `c${i}`), edge(`x${i}`, `s${i}`, `d${i}`));
    }
    const t = performance.now();
    const r = run(dia(nodes, edges), scenario([[0, 2000], [100, 6000]], { duration: 300, events: [{ at: 150, type: 'fail', role: 'cache' }] }));
    expect(r.ticks).toHaveLength(300);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
