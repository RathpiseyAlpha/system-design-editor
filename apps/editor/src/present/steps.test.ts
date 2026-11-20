import { describe, expect, it } from 'vitest';
import { fromTemplate } from '@archboard/engine';
import { presentSteps } from './steps.ts';

describe('present steps', () => {
  it('starts with the whole diagram, then every zone once, outer zones first', () => {
    const d = fromTemplate('three-tier');
    const steps = presentSteps(d);
    expect(steps[0]).toMatchObject({ id: null, title: d.title });
    expect(steps[0]!.part).toBe(d);
    expect(steps.slice(1).map((s) => s.id).sort()).toEqual(d.zones.map((z) => z.id).sort());
    const network = d.zones.find((z) => z.parent === undefined)!;
    expect(steps[1]!.id).toBe(network.id);
  });

  it('a zone step holds the zone, the zones inside it and their blocks only', () => {
    const d = fromTemplate('three-tier');
    for (const s of presentSteps(d).slice(1)) {
      expect(s.part.zones.some((z) => z.id === s.id)).toBe(true);
      for (const n of s.part.nodes) expect(s.part.zones.some((z) => z.id === n.zone)).toBe(true);
      expect(s.part.edges).toEqual([]);
    }
  });

  it('a diagram without zones has one step', () => {
    expect(presentSteps(fromTemplate('blank'))).toHaveLength(1);
  });
});
