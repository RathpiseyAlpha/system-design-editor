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

/**
 * How ground cells reach the screen. The 3D view uses the isometric P above; the flat view looks straight down, so a cell is
 * a FLAT_CELL square and connections run on the ground (no lift). Everything else (the file, routing, snapping) is shared.
 */
export interface Projection { flat: boolean; P: (gx: number, gy: number) => Pt; toGround: (x: number, y: number) => Pt; lift: number }
export const ISO: Projection = { flat: false, P, toGround, lift: LIFT };
export const FLAT_CELL = 44;
export const FLAT: Projection = { flat: true, P: (gx, gy) => [gx * FLAT_CELL, gy * FLAT_CELL], toGround: (x, y) => [x / FLAT_CELL, y / FLAT_CELL], lift: 0 };
export const projectionOf = (flat: boolean): Projection => (flat ? FLAT : ISO);

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

/** How far a card's name and kind reach below the card in the flat view. */
export const FLAT_LABEL = 34;

/**
 * Seen from above, a block's name sits under its card, so a connection that leaves a card downwards, or arrives at it from
 * below, would run under the name and hide its arrow. Such ends move down past the name (when the part is long enough).
 */
export function clearFlatLabels(screen: Pt[]): Pt[] {
  const out = screen.map((q) => [...q] as Pt);
  const n = out.length;
  if (n < 2) return out;
  const [a, b] = [out[0]!, out[1]!];
  if (Math.abs(a[0] - b[0]) < 0.5 && b[1] - a[1] > FLAT_LABEL + 24) a[1] += FLAT_LABEL;
  const [y, z] = [out[n - 2]!, out[n - 1]!];
  if (Math.abs(y[0] - z[0]) < 0.5 && y[1] - z[1] > FLAT_LABEL + 24) z[1] += FLAT_LABEL;
  return out;
}

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
export function bounds(d: Diagram, proj: Projection = ISO): { x0: number; y0: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const z of d.zones) for (const [gx, gy] of [[z.x, z.y], [z.x + z.w, z.y], [z.x + z.w, z.y + z.h], [z.x, z.y + z.h]] as Pt[]) {
    const [x, y] = proj.P(gx, gy);
    add(x, y - (proj.flat ? 16 : 30));
    add(x, y + (proj.flat ? 16 : 12));
  }
  for (const n of d.nodes) {
    const [x, y] = proj.P(n.x, n.y);
    if (proj.flat) {
      const hs = radiusOf(n.role) * FLAT_CELL;
      add(x - Math.max(hs, 50), y - hs - 6);
      add(x + Math.max(hs, 50), y + hs + 40);
    } else {
      add(x - 66, y - 120);
      add(x + 66, y + 66);
    }
  }
  if (!isFinite(x0)) return { x0: -200, y0: -150, w: 400, h: 300 };
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/** Back-to-front order for painting: blocks further back (smaller x + y) first. Ties broken by id for a stable order. */
export const paintOrder = (a: DNode, b: DNode): number => a.x + a.y - (b.x + b.y) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---------------------------------------------------------------- rotate view (M1 slice 5): the camera turns, the file does not

export type Turn = 0 | 1 | 2 | 3;

/** A ground point as seen after turning the view `r` quarter turns. */
export function rot(x: number, y: number, r: Turn): Pt {
  switch (r) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}
/** The ground point in the file for a point seen in a view turned `r` quarter turns (the inverse of rot). */
export const unrot = (x: number, y: number, r: Turn): Pt => rot(x, y, ((4 - r) % 4) as Turn);

/** A rectangle on the ground (x, y, w, h) after turning by r: both corners turn, then x, y is the smaller corner again. */
export function rotRect(z: { x: number; y: number; w: number; h: number }, r: Turn): { x: number; y: number; w: number; h: number } {
  const [ax, ay] = rot(z.x, z.y, r), [bx, by] = rot(z.x + z.w, z.y + z.h, r);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}
export const unrotRect = (z: { x: number; y: number; w: number; h: number }, r: Turn) => rotRect(z, ((4 - r) % 4) as Turn);

/** The diagram as the turned view sees it: positions and zone rectangles turned, everything else the same. */
export function rotateDiagram(d: Diagram, r: Turn): Diagram {
  if (r === 0) return d;
  return {
    ...d,
    nodes: d.nodes.map((n) => { const [x, y] = rot(n.x, n.y, r); return { ...n, x, y }; }),
    zones: d.zones.map((z) => ({ ...z, ...rotRect(z, r) })),
  };
}

// ---------------------------------------------------------------- label placement (M1 slice 5)

export interface Box { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const pillBox = (x: number, y: number, w: number): Box => ({ x0: x - w / 2 - 3, y0: y - 13, x1: x + w / 2 + 3, y1: y + 13 });

/** The screen box a block covers (body, sticker on top, name pill under a plate). */
export function blockBox(n: DNode, proj: Projection = ISO): Box {
  if (proj.flat) {
    // The card, and its name and kind under it.
    const [cx, cy] = proj.P(n.x, n.y), hs = radiusOf(n.role) * FLAT_CELL;
    return { x0: cx - Math.max(hs, 46), y0: cy - hs - 4, x1: cx + Math.max(hs, 46), y1: cy + hs + 36 };
  }
  const shape = roleInfo(n.role).shape, sh = SHAPES[shape];
  const [cx, cy] = P(n.x, n.y);
  const a = isCyl(sh) ? Math.SQRT2 * sh.r * IX : 2 * sh.s * IX, b = isCyl(sh) ? Math.SQRT2 * sh.r * IY : 2 * sh.s * IY;
  return { x0: cx - a, y0: cy - sh.h - b - 4, x1: cx + a, y1: cy + b + (shape === 'plate' ? 34 : 4) };
}

export interface LabelAsk { id: string; width: number; at: Pt[] }

/**
 * Place pill labels: each takes the first of its candidate points where it covers no block and no label placed before it,
 * or its first candidate when none is free. Asks are placed in order (zone tabs first, then connection labels).
 */
export function placeLabels(asks: LabelAsk[], blocks: Box[]): Map<string, Pt> {
  const placed: Box[] = [];
  const out = new Map<string, Pt>();
  for (const ask of asks) {
    const free = ask.at.find(([x, y]) => { const b = pillBox(x, y, ask.width); return !blocks.some((o) => overlaps(b, o)) && !placed.some((o) => overlaps(b, o)); });
    const at = free ?? ask.at[0]!;
    out.set(ask.id, at);
    placed.push(pillBox(at[0], at[1], ask.width));
  }
  return out;
}

/** Where a zone's name tab may go, best first: networks and regions below their left corner, other zones above their right. */
export function tabCandidates(z: { kind: string; x: number; y: number; w: number; h: number }, proj: Projection = ISO, width = 140): Pt[] {
  const plate = z.kind === 'network' || z.kind === 'region';
  if (proj.flat) {
    // Seen from above, the tab sits on the zone's border: top left first, then top right, bottom left, bottom right.
    const [ax, ay] = proj.P(z.x, z.y), [bx, by] = proj.P(z.x + z.w, z.y + z.h), m = width / 2 + 14;
    return [[ax + m, ay], [bx - m, ay], [ax + m, by], [bx - m, by]];
  }
  const L = P(z.x, z.y + z.h), R = P(z.x + z.w, z.y), T = P(z.x, z.y), B = P(z.x + z.w, z.y + z.h);
  const below: Pt[] = [[L[0] + 40, L[1] + 44], [B[0], B[1] + 34], [B[0] - 70, B[1] + 2]];
  const above: Pt[] = [[R[0] - 6, R[1] - 16], [T[0], T[1] - 18], [(T[0] + R[0]) / 2, (T[1] + R[1]) / 2 - 16], [(T[0] + L[0]) / 2, (T[1] + L[1]) / 2 - 16]];
  return plate ? [...below, ...above] : [...above, ...below];
}

/** Where a connection's label may go, best first: the middle of each straight part (longest part first), then its thirds. */
export function edgeLabelCandidates(screen: Pt[]): Pt[] {
  const segs = screen.slice(1).map((q, i) => ({ p: screen[i]!, q, L: Math.hypot(q[0] - screen[i]![0], q[1] - screen[i]![1]) }));
  segs.sort((a, b) => b.L - a.L);
  const at = (s: { p: Pt; q: Pt }, t: number): Pt => [s.p[0] + (s.q[0] - s.p[0]) * t, s.p[1] + (s.q[1] - s.p[1]) * t];
  return [...segs.map((s) => at(s, 0.5)), ...segs.flatMap((s) => [at(s, 1 / 3), at(s, 2 / 3)])];
}
