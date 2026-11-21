import { describe, expect, it } from 'vitest';
import { fromTemplate, simulate } from '@archboard/engine';
import { buildScenario, clock, DEFAULT_CONFIG, describeEvent, parseClock, stateAt, type ScenarioConfig } from './scenario.ts';

const shop = fromTemplate('three-tier');
const cfg = (patch: Partial<ScenarioConfig> = {}): ScenarioConfig => ({ ...DEFAULT_CONFIG, ...patch });

describe('scenario presets', () => {
  it('steady load enters at every Users block, and the scenario runs', () => {
    const r = buildScenario(cfg(), shop);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenario.load).toEqual([{ from: 'n1', rps: [[0, 200]] }]);
    expect(simulate(shop, r.scenario).ok).toBe(true);
  });

  it('a spike, a zone going down and a cut link become one timeline', () => {
    const r = buildScenario(cfg({ spike: { on: true, from: 100, to: 900, at: 60 }, zoneDown: { on: true, zone: 'z3', at: 120 }, linkCut: { on: true, edge: 'e1', at: 200 } }), shop);
    expect(r.ok && r.scenario.load[0]!.rps).toEqual([[0, 100], [60, 900]]);
    expect(r.ok && r.scenario.events.map((e) => e.type)).toEqual(['fail', 'cut']);
    expect(r.ok && r.scenario.title).toBe('Spike to 900 req/s, then a zone goes down, then a link is cut');
  });

  it('says what is missing instead of running something else', () => {
    expect(buildScenario(cfg({ blockFail: { on: true, node: '', at: 60 } }), shop)).toEqual({ ok: false, errors: ['Pick the block that fails.'] });
    expect(buildScenario(cfg({ steady: { on: false, rps: 0 } }), shop)).toMatchObject({ ok: false, errors: [expect.stringContaining('Steady load or Traffic spike')] });
    expect(buildScenario(cfg({ zoneDown: { on: true, zone: 'z3', at: 400 } }), shop)).toMatchObject({ ok: false, errors: [expect.stringContaining('after the end')] });
    expect(buildScenario(cfg(), { ...shop, nodes: shop.nodes.filter((n) => n.role !== 'client') })).toMatchObject({ ok: false, errors: [expect.stringContaining('Add a Users block')] });
  });

  it('what is down or cut at a moment, for the canvas', () => {
    const r = buildScenario(cfg({ zoneDown: { on: true, zone: 'z3', at: 120 }, linkCut: { on: true, edge: 'e2', at: 60 } }), shop);
    if (!r.ok) throw new Error();
    expect([...stateAt(r.scenario, 59).zones, ...stateAt(r.scenario, 59).cut]).toEqual([]);
    expect([...stateAt(r.scenario, 130).zones, ...stateAt(r.scenario, 130).cut]).toEqual(['z3', 'e2']);
    expect(describeEvent(r.scenario.events[0]!, shop)).toBe('"private-a" goes down.');
    expect(describeEvent(r.scenario.events[1]!, shop)).toBe('The connection "Customers" > "media" is cut.');
  });

  it('times read and write as m:ss', () => {
    expect([clock(0), clock(75), clock(300)]).toEqual(['0:00', '1:15', '5:00']);
    expect([parseClock('1:15'), parseClock('90'), parseClock('x'), parseClock('1:2:3')]).toEqual([75, 90, null, null]);
  });
});
