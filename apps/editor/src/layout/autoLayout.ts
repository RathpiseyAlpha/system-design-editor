// Auto-layout with ELK (SPEC section 4; decision 28: only when asked). Zones become ELK containers, so a block stays in its
// zone and zones stay nested; the flow runs left to right along the ground's x axis. The result is snapped to half cells.
import type { Diagram, DZone } from '@archboard/engine';

/** ELK works in its own units: one ground cell is CELL units. */
const CELL = 20;
const BLOCK = 3 * CELL; // a block's footprint plus room for its height and label in the 3D view
const ZONE_PAD = 1.5 * CELL; // room inside a zone around what it holds (more than a block's radius)

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
}
interface ElkEdge { id: string; sources: string[]; targets: string[] }
interface ElkGraph extends ElkNode { edges: ElkEdge[] }
export interface ElkLike { layout(graph: ElkGraph): Promise<ElkGraph> }

const OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': String(1.5 * CELL),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(2.5 * CELL),
  'elk.spacing.componentComponent': String(2 * CELL),
};

/** The diagram as an ELK graph: zones as containers (nested as in the file), blocks as leaves, connections as edges. */
export function toElk(d: Diagram): ElkGraph {
  const zoneNode = (z: DZone): ElkNode => ({
    id: z.id,
    layoutOptions: { 'elk.padding': `[top=${ZONE_PAD},left=${ZONE_PAD},bottom=${ZONE_PAD},right=${ZONE_PAD}]` },
    children: [
      ...d.zones.filter((c) => c.parent === z.id).map(zoneNode),
      ...d.nodes.filter((n) => n.zone === z.id).map((n) => ({ id: n.id, width: BLOCK, height: BLOCK })),
    ],
  });
  const known = new Set(d.zones.map((z) => z.id));
  return {
    id: 'root',
    layoutOptions: OPTIONS,
    children: [
      ...d.zones.filter((z) => z.parent === undefined || !known.has(z.parent)).map(zoneNode),
      ...d.nodes.filter((n) => n.zone === undefined || !known.has(n.zone)).map((n) => ({ id: n.id, width: BLOCK, height: BLOCK })),
    ],
    edges: d.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };
}

const snap = (v: number) => Math.round(v * 2) / 2;

/** Apply ELK's result: positions are relative to their container, so they are added up on the way down. */
export function fromElk(d: Diagram, laid: ElkGraph): Diagram {
  const at = new Map<string, { x: number; y: number; w: number; h: number }>();
  const walk = (n: ElkNode, ox: number, oy: number) => {
    const x = ox + (n.x ?? 0), y = oy + (n.y ?? 0);
    at.set(n.id, { x, y, w: n.width ?? 0, h: n.height ?? 0 });
    for (const c of n.children ?? []) walk(c, x, y);
  };
  for (const c of laid.children ?? []) walk(c, 0, 0);
  return {
    ...d,
    zones: d.zones.map((z) => {
      const r = at.get(z.id);
      if (!r) return z;
      const x0 = snap(r.x / CELL), y0 = snap(r.y / CELL);
      return { ...z, x: x0, y: y0, w: Math.max(2, snap((r.x + r.w) / CELL) - x0), h: Math.max(2, snap((r.y + r.h) / CELL) - y0) };
    }),
    nodes: d.nodes.map((n) => {
      const r = at.get(n.id);
      return r ? { ...n, x: snap((r.x + r.w / 2) / CELL), y: snap((r.y + r.h / 2) / CELL) } : n;
    }),
  };
}

/** Lay the whole diagram out. Membership does not change: what was in a zone is still in it. */
export async function autoLayout(d: Diagram, elk: ElkLike): Promise<Diagram> {
  return fromElk(d, await elk.layout(toElk(d)));
}
