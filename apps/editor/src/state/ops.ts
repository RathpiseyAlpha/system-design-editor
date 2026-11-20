// Pure edits of a diagram. Each returns a new diagram and never changes its input (the history keeps old versions).
import { nextId, type Diagram, type DEdge, type DNode, type DZone, type EdgeKind, type ZoneKind } from '@archboard/engine';

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

// ---------------------------------------------------------------- zones and connections (M1 slice 4)


/** Default size (in cells) of a new zone of each kind. */
const SIZE: Record<ZoneKind, [number, number]> = { region: [16, 12], network: [11, 8], zone: [7, 5], subnet: [6, 4.5], group: [5, 4] };

const containsRect = (o: DZone, z: DZone) => z.x >= o.x && z.y >= o.y && z.x + z.w <= o.x + o.w && z.y + z.h <= o.y + o.h;

/**
 * Membership follows position. Each zone's parent is the smallest other zone that holds its whole rectangle; each block's
 * zone is the innermost zone it stands in. Run after any change to zones or positions, so the file never disagrees with
 * what the canvas shows.
 */
export function reassign(d: Diagram): Diagram {
  const zones = d.zones.map((z) => {
    const holders = d.zones.filter((o) => o.id !== z.id && containsRect(o, z) && !(containsRect(z, o) && o.id > z.id));
    holders.sort((a, b) => a.w * a.h - b.w * b.h);
    const { parent: _p, ...rest } = z;
    return holders[0] ? { ...rest, parent: holders[0].id } : rest;
  });
  const next = { ...d, zones };
  const nodes = d.nodes.map((n) => {
    const z = zoneAt(next, n.x, n.y);
    const { zone: _z, ...rest } = n;
    return z ? { ...rest, zone: z.id } : rest;
  });
  return { ...next, nodes };
}

function defaultZoneLabel(d: Diagram, kind: ZoneKind, access?: string): string {
  const base = kind === 'subnet' ? `${access ?? 'private'}` : kind;
  let i = 1;
  while (d.zones.some((z) => z.label === `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Add a zone centred on (x, y), with the default size for its kind. */
export function addZone(d: Diagram, kind: ZoneKind, x: number, y: number, access?: 'public' | 'private'): { diagram: Diagram; id: string } {
  const id = nextId(d, 'z');
  const [w, h] = SIZE[kind];
  const zone: DZone = { id, kind, label: defaultZoneLabel(d, kind, access), x: x - w / 2, y: y - h / 2, w, h, ...(kind === 'subnet' ? { access: access ?? 'private' } : {}) };
  return { diagram: reassign({ ...d, zones: [...d.zones, zone] }), id };
}

/** Every zone inside `id`, at any depth (by the file's parent links). */
export function descendants(d: Diagram, id: string): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const z of d.zones) if (z.parent !== undefined && (z.parent === id || out.has(z.parent)) && !out.has(z.id)) { out.add(z.id); grew = true; }
  }
  return out;
}

/** Move a zone by (dx, dy) with everything inside it: its zones and the blocks standing in any of them. */
export function moveZone(d: Diagram, id: string, dx: number, dy: number): Diagram {
  const inside = descendants(d, id);
  inside.add(id);
  return reassign({
    ...d,
    zones: d.zones.map((z) => (inside.has(z.id) ? { ...z, x: z.x + dx, y: z.y + dy } : z)),
    nodes: d.nodes.map((n) => (n.zone !== undefined && inside.has(n.zone) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
  });
}

/** Resize a zone from its far corner (its near corner stays put). At least 2 x 2 cells. */
export function resizeZone(d: Diagram, id: string, w: number, h: number): Diagram {
  return reassign({ ...d, zones: d.zones.map((z) => (z.id === id ? { ...z, w: Math.max(2, w), h: Math.max(2, h) } : z)) });
}

export function updateZone(d: Diagram, id: string, patch: Partial<Pick<DZone, 'label' | 'kind' | 'access'>>): Diagram {
  return reassign({
    ...d,
    zones: d.zones.map((z) => {
      if (z.id !== id) return z;
      const next = { ...z, ...patch };
      if (next.kind !== 'subnet') delete next.access;
      else if (!next.access) next.access = 'private';
      return next;
    }),
  });
}

/** Delete a zone; what was inside it stays where it is and joins the zone around it. */
export function deleteZone(d: Diagram, id: string): Diagram {
  return reassign({ ...d, zones: d.zones.filter((z) => z.id !== id) });
}

/** Connect two blocks. A second connection between the same two blocks in the same direction is not added. */
export function addEdge(d: Diagram, from: string, to: string, kind: EdgeKind = 'request'): { diagram: Diagram; id: string | null } {
  if (from === to || !d.nodes.some((n) => n.id === from) || !d.nodes.some((n) => n.id === to)) return { diagram: d, id: null };
  const same = d.edges.find((e) => e.from === from && e.to === to);
  if (same) return { diagram: d, id: same.id };
  const id = nextId(d, 'e');
  const edge: DEdge = { id, from, to, kind };
  return { diagram: { ...d, edges: [...d.edges, edge] }, id };
}

export function updateEdge(d: Diagram, id: string, patch: Partial<Pick<DEdge, 'kind' | 'label'>>): Diagram {
  return {
    ...d,
    edges: d.edges.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e, ...patch };
      if (!next.label) delete next.label;
      return next;
    }),
  };
}

export function deleteEdge(d: Diagram, id: string): Diagram {
  return { ...d, edges: d.edges.filter((e) => e.id !== id) };
}
