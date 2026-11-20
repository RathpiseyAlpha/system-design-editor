import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { TEMPLATES, fromTemplate, parseDiagram } from '@archboard/engine';
import { autoLayout, type ElkLike } from './autoLayout.ts';
import { reassign } from '../state/ops.ts';

const elk = new ELK() as unknown as ElkLike;

describe('auto-layout (real ELK)', () => {
  it.each(TEMPLATES.filter((t) => t.id !== 'blank').map((t) => t.id))('%s: keeps every membership, separates blocks, stays valid', async (id) => {
    const d = fromTemplate(id);
    const laid = await autoLayout(d, elk);
    expect(parseDiagram(laid).ok).toBe(true);
    // Membership by position (what reassign derives) equals the file's: nothing left or entered a zone.
    const again = reassign(laid);
    expect(again.nodes.map((n) => [n.id, n.zone])).toEqual(d.nodes.map((n) => [n.id, n.zone]));
    expect(again.zones.map((z) => [z.id, z.parent])).toEqual(d.zones.map((z) => [z.id, z.parent]));
    // Blocks do not overlap: at least two cells apart along one axis.
    for (const a of laid.nodes) for (const b of laid.nodes) if (a.id < b.id) expect(Math.abs(a.x - b.x) >= 2 || Math.abs(a.y - b.y) >= 2, `${a.id} ${b.id}`).toBe(true);
    // Positions are on the half-cell grid.
    for (const n of laid.nodes) expect([n.x * 2 % 1, n.y * 2 % 1]).toEqual([0, 0]);
  });
});
