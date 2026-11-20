// Diagram format v1 (SPEC section 6). A file from outside is untrusted: parse it here before anything uses it.
import { z } from 'zod';
import { isRole, nearestRole, ZONE_KIND_IDS, type ZoneKind } from './roles.ts';

export const FORMAT = 'archboard';
export const VERSION = 1;
export const LIMITS = { nodes: 200, edges: 400, zones: 40, label: 60, notes: 500, docNotes: 20000, bytes: 256 * 1024 } as const;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'ids use letters, digits, - and _ (at most 40)');
const coord = z.number().finite().min(-1000).max(1000);
const label = z.string().max(LIMITS.label, `at most ${LIMITS.label} characters`);

const nodeSim = z.object({
  instances: z.number().int().min(0).max(1000).optional(),
  capacity: z.number().positive().max(1_000_000).optional(),
  latency: z.number().min(0).max(60_000).optional(),
  hitRate: z.number().min(0).max(1).optional(),
  queueSize: z.number().int().min(0).max(1_000_000_000).optional(),
  autoscale: z
    .object({
      min: z.number().int().min(0).max(1000),
      max: z.number().int().min(0).max(1000),
      threshold: z.number().min(0.05).max(1),
      warmup: z.number().min(0).max(3600).optional(),
    })
    .optional(),
});

const edgeSim = z.object({
  share: z.number().min(0).max(1).optional(),
  latency: z.number().min(0).max(60_000).optional(),
});

const zoneSchema = z.object({
  id,
  kind: z.enum(ZONE_KIND_IDS as [ZoneKind, ...ZoneKind[]]),
  label,
  access: z.enum(['public', 'private']).optional(),
  parent: id.optional(),
  x: coord,
  y: coord,
  w: z.number().positive().max(500),
  h: z.number().positive().max(500),
});

const nodeSchema = z.object({
  id,
  role: z.string().min(1).max(40),
  label,
  zone: id.optional(),
  x: coord,
  y: coord,
  product: z.record(z.string().max(20), z.string().max(40)).optional(),
  icon: z.string().max(40).optional(),
  notes: z.string().max(LIMITS.notes).optional(),
  sim: nodeSim.optional(),
});

const edgeSchema = z.object({
  id,
  from: id,
  to: id,
  kind: z.enum(['request', 'async', 'data']).default('request'),
  label: label.optional(),
  sim: edgeSim.optional(),
});

const diagramSchema = z.object({
  format: z.literal(FORMAT),
  version: z.number().int(),
  title: z.string().max(80).default('Untitled'),
  show: z.string().max(20).default('generic'),
  notes: z.string().max(LIMITS.docNotes).optional(),
  zones: z.array(zoneSchema).max(LIMITS.zones).default([]),
  nodes: z.array(nodeSchema).max(LIMITS.nodes).default([]),
  edges: z.array(edgeSchema).max(LIMITS.edges).default([]),
});

export type Diagram = z.infer<typeof diagramSchema>;
export type DNode = z.infer<typeof nodeSchema>;
export type DZone = z.infer<typeof zoneSchema>;
export type DEdge = z.infer<typeof edgeSchema>;
export type NodeSim = z.infer<typeof nodeSim>;
export type EdgeKind = DEdge['kind'];

export type ParseResult = { ok: true; diagram: Diagram } | { ok: false; errors: string[] };

/** Parse diagram JSON text: size limit, JSON, then `parseDiagram`. */
export function parseDiagramText(text: string): ParseResult {
  if (new TextEncoder().encode(text).length > LIMITS.bytes) return { ok: false, errors: [`The file is larger than ${LIMITS.bytes / 1024} KB.`] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  return parseDiagram(data);
}

/**
 * Check a diagram object. Unknown fields are dropped; every problem is reported with the id it concerns.
 * A newer version is refused with a message saying so (later versions only add fields, but a v1 reader cannot know which).
 */
export function parseDiagram(data: unknown): ParseResult {
  if (data && typeof data === 'object' && 'version' in data && typeof (data as { version: unknown }).version === 'number' && (data as { version: number }).version > VERSION) {
    return { ok: false, errors: [`This file was made by a newer version of the editor (format version ${(data as { version: number }).version}).`] };
  }
  const r = diagramSchema.safeParse(data);
  if (!r.success) {
    return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`) };
  }
  const d = r.data;
  if (d.version !== VERSION) return { ok: false, errors: [`Unknown format version ${d.version}.`] };
  const errors = checkLinks(d);
  return errors.length ? { ok: false, errors } : { ok: true, diagram: d };
}

function checkLinks(d: Diagram): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const x of [...d.zones, ...d.nodes, ...d.edges]) {
    if (seen.has(x.id)) errors.push(`The id "${x.id}" is used twice.`);
    seen.add(x.id);
  }
  const zones = new Map(d.zones.map((z) => [z.id, z]));
  const nodes = new Set(d.nodes.map((n) => n.id));
  for (const z of d.zones) {
    if (z.parent !== undefined && !zones.has(z.parent)) errors.push(`Zone "${z.id}" is inside "${z.parent}", which is not in the diagram.`);
    if (z.access !== undefined && z.kind !== 'subnet') errors.push(`Zone "${z.id}" has an access setting, which only subnets have.`);
  }
  for (const z of d.zones) {
    const path = new Set<string>([z.id]);
    let p = z.parent;
    while (p !== undefined && zones.has(p)) {
      if (path.has(p)) {
        errors.push(`Zone "${z.id}" is inside itself (through "${p}").`);
        break;
      }
      path.add(p);
      p = zones.get(p)?.parent;
    }
  }
  for (const n of d.nodes) {
    if (!isRole(n.role)) {
      const near = nearestRole(n.role);
      errors.push(`Block "${n.id}" has the role "${n.role}", which is not in the catalog.${near ? ` Did you mean "${near}"?` : ''}`);
    }
    if (n.zone !== undefined && !zones.has(n.zone)) errors.push(`Block "${n.id}" is in zone "${n.zone}", which is not in the diagram.`);
  }
  for (const e of d.edges) {
    for (const end of [e.from, e.to]) if (!nodes.has(end)) errors.push(`Connection "${e.id}" points to "${end}", which is not in the diagram.`);
    if (e.from === e.to) errors.push(`Connection "${e.id}" goes from "${e.from}" to itself.`);
  }
  return errors;
}

/** The file as text, with a fixed key order so that saving twice gives the same bytes (and clean git diffs). */
export function serializeDiagram(d: Diagram): string {
  const clean = (o: Record<string, unknown>, keys: string[]) => {
    const out: Record<string, unknown> = {};
    for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
    return out;
  };
  const doc = {
    format: FORMAT,
    version: VERSION,
    title: d.title,
    show: d.show,
    ...(d.notes !== undefined ? { notes: d.notes } : {}),
    zones: d.zones.map((z) => clean(z, ['id', 'kind', 'label', 'access', 'parent', 'x', 'y', 'w', 'h'])),
    nodes: d.nodes.map((n) => clean(n, ['id', 'role', 'label', 'zone', 'x', 'y', 'product', 'icon', 'notes', 'sim'])),
    edges: d.edges.map((e) => clean(e, ['id', 'from', 'to', 'kind', 'label', 'sim'])),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

/** An empty diagram. */
export function emptyDiagram(title = 'Untitled'): Diagram {
  return { format: FORMAT, version: VERSION, title, show: 'generic', zones: [], nodes: [], edges: [] };
}

/** A new id not used in the diagram, such as "n7", "z3" or "e12". */
export function nextId(d: Diagram, prefix: 'n' | 'z' | 'e'): string {
  const used = new Set([...d.nodes, ...d.zones, ...d.edges].map((x) => x.id));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}
