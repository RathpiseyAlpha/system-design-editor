import { describe, expect, it } from 'vitest';
import { fromTemplate, type DNode } from '@archboard/engine';
import { P, toGround, snap, route, rounded, bounds, paintOrder, radiusOf } from './geometry.ts';

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

  it('routes every connection of the 3-tier template without crossing a block', () => {
    const d = fromTemplate('three-tier');
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
