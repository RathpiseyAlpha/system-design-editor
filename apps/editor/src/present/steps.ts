// Present mode's steps: the whole diagram first, then each zone in reading order (outer zones before the zones inside them,
// then back to front, left to right). Each step carries the part of the diagram the view should fit.
import type { Diagram } from '@archboard/engine';
import { descendants } from '../state/ops.ts';

export interface Step {
  /** The zone this step shows, or null for the whole diagram. */
  id: string | null;
  title: string;
  /** What the view fits: the zone, the zones inside it and their blocks (connections are not needed to fit). */
  part: Diagram;
}

export function presentSteps(d: Diagram): Step[] {
  const byId = new Map(d.zones.map((z) => [z.id, z]));
  const depth = (id: string): number => {
    let n = 0, p = byId.get(id)?.parent;
    while (p !== undefined && byId.has(p) && n < 40) { n++; p = byId.get(p)!.parent; }
    return n;
  };
  const zones = [...d.zones].sort((a, b) => depth(a.id) - depth(b.id) || a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  return [
    { id: null, title: d.title, part: d },
    ...zones.map((z) => {
      const inside = descendants(d, z.id).add(z.id);
      return {
        id: z.id,
        title: z.label,
        part: { ...d, zones: d.zones.filter((x) => inside.has(x.id)), nodes: d.nodes.filter((n) => n.zone !== undefined && inside.has(n.zone)), edges: [] },
      };
    }),
  ];
}
