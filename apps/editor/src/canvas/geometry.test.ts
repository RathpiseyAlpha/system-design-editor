import { describe, expect, it } from 'vitest';
import { fromTemplate, type DNode } from '@archboard/engine';
import { P, toGround, snap, route, rounded, bounds, paintOrder, radiusOf, FLAT, FLAT_CELL, ISO, projectionOf, tabCandidates, clearFlatLabels, FLAT_LABEL } from './geometry.ts';

const node = (id: string, x: number, y: number, role = 'vm'): DNode => ({ id, role, label: id, x, y });

describe('projection', () => {
  it('toGround inverts P', () => {
    for (const [gx, gy] of [[0, 0], [3.5, -2], [10.2, 8], [-4, 12.5]] as const) {
      const [x, y] = toGround(...P(gx, gy));
      expect(x).toBeCloseTo(gx, 9);
      expect(y).toBeCloseTo(gy, 9);
    }
  });
  it('snaps to half cells', () => {
    expect(snap(3.24)).toBe(3);
    expect(snap(3.26)).toBe(3.5);
    expect(snap(-1.76)).toBe(-2);
  });
});

describe('routing', () => {
  it('goes straight when two blocks share a grid line', () => {
    const p = route(node('a', 0, 0), node('b', 6, 0), []);
    expect(p).toHaveLength(2);
    expect(p[0]![1]).toBe(0);
    expect(p[1]![1]).toBe(0);
  });

  it('avoids a block in the way', () => {
    const a = node('a', 0, 0), b = node('b', 8, 6), blocker = node('c', 8, 0);
    const p = route(a, b, [a, b, blocker]);
    // The x-first L would turn at (8, 0), right on the blocker: the router must pick another shape.
    const throughBlocker = p.some(([x, y]) => Math.abs(x - 8) < 0.01 && Math.abs(y - 0) < 0.01);
    expect(throughBlocker).toBe(false);
  });

  it('never ends with the arrow pointing backwards', () => {
    const a = node('a', 0, 0), b = node('b', 1.5, 4, 'relational-db');
    const p = route(a, b, [a, b]);
    const last = p[p.length - 1]!, prev = p[p.length - 2]!;
    const towards = Math.hypot(b.x - last[0], b.y - last[1]) < Math.hypot(b.x - prev[0], b.y - prev[1]);
    expect(towards).toBe(true);
  });

  it('stops short of both blocks', () => {
    const a = node('a', 0, 0), b = node('b', 10, 0, 'cache');
    const p = route(a, b, [a, b]);
    expect(p[0]![0]).toBeCloseTo(radiusOf('vm') + 0.05);
    expect(p[1]![0]).toBeCloseTo(10 - radiusOf('cache') - 0.28);
  });

  it.each(['static-website', 'three-tier', 'microservices', 'serverless-api', 'event-pipeline'])('routes every connection of the %s template without crossing a block', (tpl) => {
    const d = fromTemplate(tpl);
    const byId = new Map(d.nodes.map((n) => [n.id, n]));
    for (const e of d.edges) {
      const p = route(byId.get(e.from)!, byId.get(e.to)!, d.nodes);
      for (const o of d.nodes) {
        if (o.id === e.from || o.id === e.to) continue;
        for (let i = 1; i < p.length; i++) {
          const [a, b] = [p[i - 1]!, p[i]!];
          const inside = (q: [number, number]) => Math.abs(q[0] - o.x) < radiusOf(o.role) && Math.abs(q[1] - o.y) < radiusOf(o.role);
          expect(inside(a) || inside(b), `${e.id} through ${o.id}`).toBe(false);
        }
      }
    }
  });
});

describe('drawing helpers', () => {
  it('rounded() closes the path and rounds every corner', () => {
    const d = rounded([[0, 0], [10, 0], [10, 10], [0, 10]], 2);
    expect(d.startsWith('M')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
    expect((d.match(/Q/g) ?? []).length).toBe(4);
  });
  it('bounds() covers every block and zone', () => {
    const b = bounds(fromTemplate('three-tier'));
    expect(b.w).toBeGreaterThan(500);
    expect(b.h).toBeGreaterThan(300);
  });
  it('paints back to front, stably', () => {
    const order = [node('b', 2, 2), node('a', 2, 2), node('c', 0, 1)].sort(paintOrder).map((n) => n.id);
    expect(order).toEqual(['c', 'a', 'b']);
  });
});

import { rot, unrot, rotRect, unrotRect, rotateDiagram, placeLabels, blockBox } from './geometry.ts';

describe('rotate view', () => {
  it('four quarter turns come back, and unrot inverts rot', () => {
    for (const r of [0, 1, 2, 3] as const) {
      const [x, y] = rot(3.5, -2, r);
      expect(unrot(x, y, r)).toEqual([3.5, -2].map((v) => v + 0) as [number, number]);
    }
  });
  it('a turned zone rectangle turns back to itself', () => {
    const z = { x: 3.8, y: 0.5, w: 3.8, h: 9.2 };
    for (const r of [1, 2, 3] as const) {
      const back = unrotRect(rotRect(z, r), r);
      expect(back.x).toBeCloseTo(z.x); expect(back.y).toBeCloseTo(z.y); expect(back.w).toBeCloseTo(z.w); expect(back.h).toBeCloseTo(z.h);
    }
  });
  it('turning keeps blocks inside their zones', () => {
    const d = rotateDiagram(fromTemplate('three-tier'), 1);
    for (const n of d.nodes) {
      const z = d.zones.find((x) => x.id === n.zone);
      if (z) expect(n.x >= z.x && n.x <= z.x + z.w && n.y >= z.y && n.y <= z.y + z.h, n.id).toBe(true);
    }
  });
});

describe('label placement', () => {
  it('moves a label off a block when another place is free', () => {
    const block = blockBox(node('a', 0, 0));
    const onBlock: [number, number] = [(block.x0 + block.x1) / 2, (block.y0 + block.y1) / 2];
    const at = placeLabels([{ id: 't', width: 80, at: [onBlock, [500, 500]] }], [block]);
    expect(at.get('t')).toEqual([500, 500]);
  });
  it('two labels never share a place when there is room', () => {
    const at = placeLabels([{ id: 'a', width: 80, at: [[0, 0]] }, { id: 'b', width: 80, at: [[10, 0], [0, 100]] }], []);
    expect(at.get('b')).toEqual([0, 100]);
  });
});

describe('flat view (M2 slice 4)', () => {
  it('FLAT.toGround inverts FLAT.P, and a cell is a FLAT_CELL square', () => {
    for (const [gx, gy] of [[0, 0], [3.5, -2], [10.25, 8]] as const) {
      const [x, y] = FLAT.toGround(...FLAT.P(gx, gy));
      expect(x).toBeCloseTo(gx, 9);
      expect(y).toBeCloseTo(gy, 9);
    }
    expect(FLAT.P(1, 1)).toEqual([FLAT_CELL, FLAT_CELL]);
    expect(projectionOf(true)).toBe(FLAT);
    expect(projectionOf(false)).toBe(ISO);
  });
  it('bounds in the flat view hold every card and zone', () => {
    const d = fromTemplate('three-tier');
    const b = bounds(d, FLAT);
    for (const n of d.nodes) {
      const box = blockBox(n, FLAT);
      expect(box.x0).toBeGreaterThanOrEqual(b.x0 - 0.01);
      expect(box.x1).toBeLessThanOrEqual(b.x0 + b.w + 0.01);
      expect(box.y0).toBeGreaterThanOrEqual(b.y0 - 0.01);
      expect(box.y1).toBeLessThanOrEqual(b.y0 + b.h + 0.01);
    }
    for (const z of d.zones) {
      const [x1, y1] = FLAT.P(z.x + z.w, z.y + z.h);
      expect(x1).toBeLessThanOrEqual(b.x0 + b.w + 0.01);
      expect(y1).toBeLessThanOrEqual(b.y0 + b.h + 0.01);
    }
  });
  it('a flat card is the block footprint, so connections end at its edge', () => {
    const n = node('a', 2, 3);
    const box = blockBox(n, FLAT), [cx, cy] = FLAT.P(2, 3);
    expect(cy - box.y0).toBeCloseTo(radiusOf('vm') * FLAT_CELL + 4, 6);
    expect(cx).toBeCloseTo((box.x0 + box.x1) / 2, 6);
  });
  it('flat zone tabs sit on the border, top left first, and clear of the corner', () => {
    const z = { kind: 'subnet', x: 1, y: 2, w: 8, h: 5 };
    const c = tabCandidates(z, FLAT, 120);
    expect(c[0]).toEqual([FLAT_CELL + 74, 2 * FLAT_CELL]);
    expect(c).toHaveLength(4);
    // The 3D candidates are unchanged when no projection is given.
    expect(tabCandidates(z)).toEqual(tabCandidates(z, ISO));
  });
});

describe('flat connections clear the names', () => {
  it('an arrow arriving from below stops under the name; one arriving from the side does not move', () => {
    expect(clearFlatLabels([[0, 300], [0, 50]])).toEqual([[0, 300], [0, 50 + FLAT_LABEL]]);
    expect(clearFlatLabels([[0, 50], [0, 300]])).toEqual([[0, 50 + FLAT_LABEL], [0, 300]]);
    expect(clearFlatLabels([[0, 0], [200, 0]])).toEqual([[0, 0], [200, 0]]);
    // Too short to shorten: left alone.
    expect(clearFlatLabels([[0, 100], [0, 60]])).toEqual([[0, 100], [0, 60]]);
  });
});
