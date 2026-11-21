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
