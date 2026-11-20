// Isometric geometry, ported from the design page's renderer (design/design-system.html). Pure functions, no DOM.
// Ground grid cells (the file's units) project to the screen: one cell is IX px across and IY px down at 100% zoom.
import { roleInfo, type Diagram, type DNode, type Shape } from '@archboard/engine';

export const IX = 34.64;
export const IY = 20;
export const LIFT = 22; // connections run at this height above the ground
export const RB = 5; // rounded outer corners of box, low box and plate blocks (tokens.css --r-block)
export const STK = 30; // icon sticker size (tokens.css --sticker-size)

export type Pt = [number, number];

/** Ground cell -> screen point (at zoom 1, before pan). */
export const P = (gx: number, gy: number): Pt => [(gx - gy) * IX, (gx + gy) * IY];

/** Screen point -> ground cell (the inverse of P). */
export const toGround = (x: number, y: number): Pt => [(x / IX + y / IY) / 2, (y / IY - x / IX) / 2];

/** Snap a ground coordinate to the half cell. */
export const snap = (v: number, step = 0.5): number => Math.round(v / step) * step;

export interface BoxShape { s: number; h: number }
export interface CylShape { r: number; h: number }
export const SHAPES: Record<Shape, BoxShape | CylShape> = {
  box: { s: 0.9, h: 56 },
  server: { s: 0.9, h: 60 }, // a rack server: three units with grooves, a status light, a drive bay and vents
  low: { s: 0.95, h: 42 },
  plate: { s: 1.2, h: 14 },
  cyl: { r: 1.05, h: 46 },
};
export const isCyl = (sh: BoxShape | CylShape): sh is CylShape => 'r' in sh;

/** Half the footprint of a block, in cells: how far a connection stops short of its centre. */
export function radiusOf(role: string): number {
  const sh = SHAPES[roleInfo(role).shape];
  return isCyl(sh) ? sh.r : sh.s;
}

export const f = (n: number): number => Math.round(n * 10) / 10;
export const pts = (a: Pt[]): string => a.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

/** A closed polygon with every corner rounded by r (quadratic corners). */
export function rounded(points: Pt[], r: number): string {
  const n = points.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!, p1 = points[i]!, p2 = points[(i + 1) % n]!;
    const v1: Pt = [p0[0] - p1[0], p0[1] - p1[1]], v2: Pt = [p2[0] - p1[0], p2[1] - p1[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2), rr = Math.min(r, l1 / 2, l2 / 2);
    const a: Pt = [p1[0] + (v1[0] / l1) * rr, p1[1] + (v1[1] / l1) * rr];
    const b: Pt = [p1[0] + (v2[0] / l2) * rr, p1[1] + (v2[1] / l2) * rr];
    d += `${i ? 'L' : 'M'}${f(a[0])} ${f(a[1])} Q${f(p1[0])} ${f(p1[1])} ${f(b[0])} ${f(b[1])} `;
  }
  return d + 'Z';
}

/** Width of a pill label (JetBrains Mono 12px semibold: about 7.25 px per character). */
export const pillWidth = (text: string, sub = '', icon = false): number => (text.length + (sub ? sub.length + 2 : 0)) * 7.25 + 18 + (icon ? 20 : 0);

// ---------------------------------------------------------------- connection routing (SPEC section 6: no bends in the file)

const cut = (q: Pt, to: Pt, d: number): Pt => {
  const dx = to[0] - q[0], dy = to[1] - q[1], l = Math.hypot(dx, dy) || 1;
  return [q[0] + (dx / l) * d, q[1] + (dy / l) * d];
};
const segLen = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Does an axis-aligned segment pass through the square around a block? */
function hits(a: Pt, b: Pt, c: Pt, half: number): boolean {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return x1 >= c[0] - half && x0 <= c[0] + half && y1 >= c[1] - half && y0 <= c[1] + half;
}

/**
 * Route a connection on the ground, along the two grid axes. Tries a straight line, two L shapes and two Z shapes, drops any
 * whose first or last part is too short to leave room for the arrow, and keeps the one that crosses the fewest other blocks,
 * then the fewest turns. The ends are pulled back to the edges of the two blocks. Falls back to a straight diagonal.
 */
export function route(from: DNode, to: DNode, nodes: DNode[]): Pt[] {
  const A: Pt = [from.x, from.y], B: Pt = [to.x, to.y];
  const rA = radiusOf(from.role), rB = radiusOf(to.role);
  const cands: Pt[][] = [];
  if (A[0] === B[0] || A[1] === B[1]) cands.push([A, B]);
  else {
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    cands.push([A, [B[0], A[1]], B], [A, [A[0], B[1]], B], [A, [mx, A[1]], [mx, B[1]], B], [A, [A[0], my], [B[0], my], B]);
  }
  const others = nodes.filter((n) => n.id !== from.id && n.id !== to.id);
  let best: Pt[] | null = null, bestScore = Infinity;
  for (const c of cands) {
    if (segLen(c[0]!, c[1]!) <= rA + 0.15 || segLen(c[c.length - 2]!, c[c.length - 1]!) <= rB + 0.45) continue;
    let crossings = 0;
    for (let i = 1; i < c.length; i++) for (const o of others) if (hits(c[i - 1]!, c[i]!, [o.x, o.y], radiusOf(o.role) + 0.1)) crossings++;
    const score = crossings * 100 + (c.length - 2);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  const p = (best ?? [A, B]).map((q) => [...q] as Pt);
  p[0] = cut(p[0]!, p[1]!, rA + 0.05);
  p[p.length - 1] = cut(p[p.length - 1]!, p[p.length - 2]!, rB + 0.28);
  return p;
}

/** Screen-space box around everything in a diagram (blocks with their height and labels, zone plates). */
export function bounds(d: Diagram): { x0: number; y0: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const z of d.zones) for (const [gx, gy] of [[z.x, z.y], [z.x + z.w, z.y], [z.x + z.w, z.y + z.h], [z.x, z.y + z.h]] as Pt[]) {
    const [x, y] = P(gx, gy);
    add(x, y - 30);
    add(x, y + 12);
  }
  for (const n of d.nodes) {
    const [x, y] = P(n.x, n.y);
    add(x - 66, y - 120);
    add(x + 66, y + 66);
  }
  if (!isFinite(x0)) return { x0: -200, y0: -150, w: 400, h: 300 };
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/** Back-to-front order for painting: blocks further back (smaller x + y) first. Ties broken by id for a stable order. */
export const paintOrder = (a: DNode, b: DNode): number => a.x + a.y - (b.x + b.y) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
