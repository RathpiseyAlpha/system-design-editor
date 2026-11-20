// Pure edits of a diagram. Each returns a new diagram and never changes its input (the history keeps old versions).
import { nextId, type Diagram, type DNode, type DZone } from '@archboard/engine';

const depthOf = (d: Diagram, z: DZone): number => {
  let n = 0, p = z.parent;
  const byId = new Map(d.zones.map((x) => [x.id, x]));
  while (p !== undefined && byId.has(p) && n < 40) { n++; p = byId.get(p)!.parent; }
  return n;
};

/** The innermost zone whose ground rectangle contains (x, y), or undefined. */
export function zoneAt(d: Diagram, x: number, y: number): DZone | undefined {
  return d.zones
    .filter((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h)
    .sort((a, b) => depthOf(d, b) - depthOf(d, a) || a.w * a.h - b.w * b.h)[0];
}

/** A free spot at or near (x, y): steps one cell along the grid until no block stands there. */
export function freeSpot(d: Diagram, x: number, y: number): [number, number] {
  const taken = (px: number, py: number) => d.nodes.some((n) => Math.abs(n.x - px) < 1.8 && Math.abs(n.y - py) < 1.8);
  for (let ring = 0; ring < 12; ring++) {
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2], [-2, 0], [0, -2], [-2, -2], [2, -2], [-2, 2]] as const) {
      const px = x + dx * ring, py = y + dy * ring;
      if (!taken(px, py)) return [px, py];
      if (ring === 0) break;
    }
  }
  return [x, y];
}

/** A readable default label: the role id and the next free number ("vm-3"). */
function defaultLabel(d: Diagram, role: string): string {
  let i = 1;
  while (d.nodes.some((n) => n.label === `${role}-${i}`)) i++;
  return `${role}-${i}`;
}

export function addNode(d: Diagram, role: string, x: number, y: number): { diagram: Diagram; id: string } {
  const id = nextId(d, 'n');
  const [px, py] = freeSpot(d, x, y);
  const zone = zoneAt(d, px, py);
  const node: DNode = { id, role, label: defaultLabel(d, role), x: px, y: py, ...(zone ? { zone: zone.id } : {}) };
  return { diagram: { ...d, nodes: [...d.nodes, node] }, id };
}

/** Move a block; it joins the innermost zone it now stands in, or leaves its zone when it stands in none. */
export function moveNode(d: Diagram, id: string, x: number, y: number): Diagram {
  const zone = zoneAt(d, x, y);
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      if (n.id !== id) return n;
      const { zone: _old, ...rest } = n;
      return { ...rest, x, y, ...(zone ? { zone: zone.id } : {}) };
    }),
  };
}

export function updateNode(d: Diagram, id: string, patch: Partial<Omit<DNode, 'id'>>): Diagram {
  return { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Delete blocks and every connection that touches them. */
export function deleteNodes(d: Diagram, ids: string[]): Diagram {
  const gone = new Set(ids);
  return { ...d, nodes: d.nodes.filter((n) => !gone.has(n.id)), edges: d.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)) };
}
