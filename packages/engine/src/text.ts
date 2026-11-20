// Diagram as code (SPEC section 4, v1.5). The text says what exists, what it is called, what is inside what and what is
// connected; the file keeps the rest (positions, notes, capacity settings, product choices for other packs).
//
//   title "Online shop"
//   show aws                        // the icon pack the diagram opens in
//   Customers: client               // name: role [attributes]
//   network shop-net {              // kind name [public|private] { ... }
//     subnet private-a private {
//       app-1, app-2: vm            // several names, one role
//       orders-db: relational-db [product: postgresql]
//     }
//   }
//   Customers > web-lb "HTTPS"      // >  request,  ~>  async message,  .>  data
//   web-lb > app-1, app-2           // fan-out
//
// Names are unquoted when they are letters, digits, - _ and . (not starting with .), otherwise "quoted". Two blocks with the
// same name are told apart with [id: n3], and a connection reaches them with @n3. Comments run from // to the end of the line.
import { isRole, nearestRole, roleInfo, ZONE_KIND_IDS, type ZoneKind } from './roles.ts';
import { emptyDiagram, nextId, type Diagram, type DEdge, type DNode, type DZone, type EdgeKind } from './format.ts';

export interface TextError {
  line: number; // 1-based
  from: number; // column, 0-based
  to: number;
  message: string;
  /** A one-click fix: replace [from, to) on the line with this text. */
  fix?: { label: string; insert: string };
}

interface TBlock { name: string; role: string; product?: string; icon?: string; id?: string; zone: number | null; line: number }
interface TZone { kind: ZoneKind; name: string; access?: 'public' | 'private'; parent: number | null; line: number }
interface TRef { name: string; byId: boolean; line: number; from: number; to: number }
interface TEdge { from: TRef; to: TRef; kind: EdgeKind; label?: string }
export interface TextDoc { title?: string; show?: string; zones: TZone[]; blocks: TBlock[]; edges: TEdge[] }

export type TextResult = { ok: true; doc: TextDoc } | { ok: false; errors: TextError[] };

// ---------------------------------------------------------------- tokens

type Tok = { t: 'name' | 'str' | 'idref' | 'punct' | 'op'; v: string; from: number; to: number };
const NAME = /[A-Za-z0-9_.-]/;
const KEYWORDS = new Set(['title', 'show', 'public', 'private', ...ZONE_KIND_IDS]);
const OPS: Record<string, EdgeKind> = { '>': 'request', '~>': 'async', '.>': 'data' };
const OP_OF: Record<EdgeKind, string> = { request: '>', async: '~>', data: '.>' };

function tokenize(line: string, n: number, errors: TextError[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '"') {
      let j = i + 1, v = '';
      while (j < line.length && line[j] !== '"') { if (line[j] === '\\' && j + 1 < line.length) j++; v += line[j]; j++; }
      if (j >= line.length) { errors.push({ line: n, from: i, to: line.length, message: 'This text is never closed. Add " at its end.' }); return out; }
      out.push({ t: 'str', v, from: i, to: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === '~' && line[i + 1] === '>') { out.push({ t: 'op', v: '~>', from: i, to: i + 2 }); i += 2; continue; }
    if (c === '.' && line[i + 1] === '>') { out.push({ t: 'op', v: '.>', from: i, to: i + 2 }); i += 2; continue; }
    if (c === '>') { out.push({ t: 'op', v: '>', from: i, to: i + 1 }); i++; continue; }
    if ('{}[],:'.includes(c)) { out.push({ t: 'punct', v: c, from: i, to: i + 1 }); i++; continue; }
    if (c === '@' || NAME.test(c)) {
      let j = c === '@' ? i + 1 : i;
      while (j < line.length && NAME.test(line[j]!) && !(line[j] === '.' && line[j + 1] === '>')) j++;
      out.push({ t: c === '@' ? 'idref' : 'name', v: line.slice(c === '@' ? i + 1 : i, j), from: i, to: j });
      i = j;
      continue;
    }
    errors.push({ line: n, from: i, to: i + 1, message: `"${c}" cannot be used here. Put names with spaces or symbols in "quotes".` });
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- parse

/** Read diagram text. Every problem is reported on its line; with any error there is no result. */
export function parseText(text: string): TextResult {
  const errors: TextError[] = [];
  const doc: TextDoc = { zones: [], blocks: [], edges: [] };
  const stack: { zone: number; line: number; from: number }[] = [];
  const declared = new Map<string, number>(); // name -> line (without an id attribute)
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const n = idx + 1;
    const toks = tokenize(raw, n, errors);
    if (!toks.length) return;
    const at = (k: number) => toks[k];
    const err = (tok: Tok | undefined, message: string, fix?: TextError['fix']) =>
      errors.push({ line: n, from: tok?.from ?? 0, to: tok?.to ?? raw.length, message, ...(fix ? { fix } : {}) });
    const first = toks[0]!;
    const zone = stack.length ? stack[stack.length - 1]!.zone : null;

    if (first.t === 'punct' && first.v === '}') {
      if (!stack.pop()) err(first, 'This } closes nothing. Remove it, or add the zone it should close.');
      if (toks.length > 1) err(toks[1], 'Put what follows } on its own line.');
      return;
    }
    if (first.t === 'name' && first.v === 'title' && toks.length >= 2 && at(1)!.t !== 'punct') {
      doc.title = at(1)!.v;
      return;
    }
    if (first.t === 'name' && first.v === 'show' && toks.length >= 2 && at(1)!.t === 'name') {
      doc.show = at(1)!.v;
      return;
    }
    // A zone: kind name [public|private] {
    if (first.t === 'name' && (ZONE_KIND_IDS as string[]).includes(first.v) && toks.length >= 2 && at(1)!.t !== 'punct') {
      const kind = first.v as ZoneKind;
      const name = at(1)!;
      let k = 2, access: 'public' | 'private' | undefined;
      if (at(k)?.t === 'name' && (at(k)!.v === 'public' || at(k)!.v === 'private')) {
        if (kind !== 'subnet') err(at(k), `Only a subnet is ${at(k)!.v}. Remove "${at(k)!.v}", or make this zone a subnet.`);
        else access = at(k)!.v as 'public' | 'private';
        k++;
      }
      if (!(at(k)?.t === 'punct' && at(k)!.v === '{')) { err(at(k) ?? name, `Open the zone with { after its name, for example: ${kind} ${name.v} {`); return; }
      if (toks.length > k + 1) err(toks[k + 1], 'Put the zone\'s contents on the next lines, and } on a line of its own.');
      doc.zones.push({ kind, name: name.v, ...(kind === 'subnet' ? { access: access ?? 'private' } : {}), parent: zone, line: n });
      stack.push({ zone: doc.zones.length - 1, line: n, from: name.from });
      return;
    }
    // Names before ":" (a declaration) or before an operator (connections).
    const names: Tok[] = [];
    let k = 0;
    while (k < toks.length) {
      const tok = toks[k]!;
      if (tok.t !== 'name' && tok.t !== 'str' && tok.t !== 'idref') break;
      names.push(tok);
      k++;
      if (at(k)?.t === 'punct' && at(k)!.v === ',') k++;
      else break;
    }
    const next = at(k);
    if (!names.length || !next) { err(first, 'Expected a block ("name: role"), a connection ("a > b"), or a zone ("network name {").'); return; }

    if (next.t === 'punct' && next.v === ':') {
      const role = at(k + 1);
      if (!role || role.t !== 'name') { err(role ?? next, 'Write the role after ":", for example "app-1: vm".'); return; }
      if (!isRole(role.v)) {
        const near = nearestRole(role.v);
        err(role, `There is no service called "${role.v}".${near ? ` Did you mean "${near}"?` : ''}`, near ? { label: `Use ${near}`, insert: near } : undefined);
        return;
      }
      const attrs: Record<string, string> = {};
      let j = k + 2;
      if (at(j)?.t === 'punct' && at(j)!.v === '[') {
        j++;
        while (at(j) && !(at(j)!.t === 'punct' && at(j)!.v === ']')) {
          const key = at(j), colon = at(j + 1), val = at(j + 2);
          if (!key || key.t !== 'name' || !colon || colon.v !== ':' || !val || (val.t !== 'name' && val.t !== 'str')) { err(key, 'Write attributes as [key: value, key: value].'); return; }
          if (!['product', 'icon', 'id'].includes(key.v)) { err(key, `"${key.v}" is not an attribute. Use product, icon or id.`); return; }
          attrs[key.v] = val.v;
          j += 3;
          if (at(j)?.t === 'punct' && at(j)!.v === ',') j++;
        }
        if (!at(j)) { err(next, 'Close the attributes with ].'); return; }
        j++;
      }
      if (at(j)) { err(at(j), 'Nothing can follow a block\'s role and attributes on its line.'); return; }
      if (attrs.id && names.length > 1) { err(names[0], 'An [id: ...] belongs to one block: give it its own line.'); return; }
      for (const nm of names) {
        if (nm.t === 'idref') { err(nm, 'Use @id only in connections.'); continue; }
        if (!attrs.id) {
          const prev = declared.get(nm.v);
          if (prev !== undefined) { err(nm, `"${nm.v}" is already declared on line ${prev}. Give each block its own name.`); continue; }
          declared.set(nm.v, n);
        }
        if (!roleInfo(role.v)) continue;
        doc.blocks.push({ name: nm.v, role: role.v, ...(attrs.product ? { product: attrs.product } : {}), ...(attrs.icon ? { icon: attrs.icon } : {}), ...(attrs.id ? { id: attrs.id } : {}), zone, line: n });
      }
      return;
    }

    if (next.t === 'op') {
      const kind = OPS[next.v]!;
      const targets: Tok[] = [];
      let j = k + 1;
      while (at(j) && (at(j)!.t === 'name' || at(j)!.t === 'idref' || (at(j)!.t === 'str' && at(j + 1)?.v === ','))) {
        targets.push(at(j)!);
        j++;
        if (at(j)?.t === 'punct' && at(j)!.v === ',') j++;
        else break;
      }
      // A last quoted name with no label after it is a target too.
      if (!targets.length && at(j)?.t === 'str' && !at(j + 1)) { targets.push(at(j)!); j++; }
      if (!targets.length) { err(next, `Write what ${next.v} connects to, for example "${names[0]!.v} ${next.v} db".`); return; }
      let label: string | undefined;
      if (at(j)?.t === 'str') { label = at(j)!.v; j++; }
      if (at(j)) { err(at(j), 'Only a "label" can follow a connection.'); return; }
      const ref = (tok: Tok): TRef => ({ name: tok.v, byId: tok.t === 'idref', line: n, from: tok.from, to: tok.to });
      for (const a of names) for (const b of targets) doc.edges.push({ from: ref(a), to: ref(b), kind, ...(label !== undefined ? { label } : {}) });
      return;
    }
    err(next, 'Expected ":" and a role, or a connection (>, ~> or .>).');
  });

  for (const open of stack) errors.push({ line: open.line, from: open.from, to: lines[open.line - 1]!.length, message: 'This zone is never closed. Add } after its last line.' });

  // Connections must name declared blocks.
  const names = new Set(doc.blocks.map((b) => b.name)), ids = new Set(doc.blocks.map((b) => b.id).filter(Boolean));
  const dupNames = new Set(doc.blocks.filter((b, i) => doc.blocks.findIndex((o) => o.name === b.name) !== i).map((b) => b.name));
  for (const e of doc.edges) {
    for (const r of [e.from, e.to]) {
      if (r.byId ? !ids.has(r.name) : !names.has(r.name)) {
        errors.push({ line: r.line, from: r.from, to: r.to, message: r.byId ? `No block has the id "${r.name}".` : `No block is called "${r.name}". Declare it first, for example "${r.name}: service".` });
      } else if (!r.byId && dupNames.has(r.name)) {
        errors.push({ line: r.line, from: r.from, to: r.to, message: `Two blocks are called "${r.name}": say which with @ and its id, for example @${doc.blocks.find((b) => b.name === r.name && b.id)?.id ?? 'n1'}.` });
      }
    }
  }
  errors.sort((a, b) => a.line - b.line || a.from - b.from);
  return errors.length ? { ok: false, errors } : { ok: true, doc };
}

// ---------------------------------------------------------------- print

const BARE = /^[A-Za-z0-9_-][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*$/;
export const quoteName = (s: string): string => (BARE.test(s) && !KEYWORDS.has(s) ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
const quoteText = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The diagram as text: blocks outside zones, then each zone with what is inside it, then the connections. */
export function printText(d: Diagram): string {
  const out: string[] = [`title ${quoteText(d.title)}`, `show ${d.show}`];
  const dup = new Set(d.nodes.filter((n, i) => d.nodes.findIndex((o) => o.label === n.label) !== i).map((n) => n.label));
  const block = (n: DNode, pad: string) => {
    const attrs = [
      ...(n.product?.oss ? [`product: ${quoteName(n.product.oss)}`] : []),
      ...(n.icon ? [`icon: ${quoteName(n.icon)}`] : []),
      ...(dup.has(n.label) ? [`id: ${n.id}`] : []),
    ];
    return `${pad}${quoteName(n.label)}: ${n.role}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`;
  };
  const known = new Set(d.zones.map((z) => z.id));
  const top = d.nodes.filter((n) => n.zone === undefined || !known.has(n.zone));
  if (top.length) { out.push(''); for (const n of top) out.push(block(n, '')); }
  const zoneLines = (z: DZone, depth: number): string[] => {
    const pad = '  '.repeat(depth);
    const lines = [`${pad}${z.kind} ${quoteName(z.label)}${z.kind === 'subnet' ? ` ${z.access ?? 'private'}` : ''} {`];
    for (const n of d.nodes) if (n.zone === z.id) lines.push(block(n, pad + '  '));
    for (const c of d.zones) if (c.parent === z.id) lines.push(...zoneLines(c, depth + 1));
    lines.push(`${pad}}`);
    return lines;
  };
  for (const z of d.zones) if (z.parent === undefined || !known.has(z.parent)) { out.push(''); out.push(...zoneLines(z, 0)); }
  if (d.edges.length) out.push('');
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const ref = (id: string) => { const n = byId.get(id); return !n ? `@${id}` : dup.has(n.label) ? `@${n.id}` : quoteName(n.label); };
  for (const e of d.edges) out.push(`${ref(e.from)} ${OP_OF[e.kind]} ${ref(e.to)}${e.label ? ` ${quoteText(e.label)}` : ''}`);
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- merge

const SIZE: Record<ZoneKind, [number, number]> = { region: [16, 12], network: [11, 8], zone: [7, 5], subnet: [6, 4.5], group: [5, 4] };
const RADIUS = 1.3; // room around a block inside a zone

/**
 * Apply parsed text to a diagram. What the text names keeps its id, position and everything the text does not say
 * (notes, capacity settings, products of other packs); new names become new blocks, zones and connections; names the text
 * no longer has are removed (a rename is a removal and an addition). The text decides what is inside what: blocks and
 * zones are moved into the zone the text puts them in, and zones grow to hold what they contain.
 */
export function mergeText(current: Diagram, doc: TextDoc): Diagram {
  let d: Diagram = { ...emptyDiagram(), ...current, title: doc.title ?? current.title, show: doc.show ?? current.show, nodes: [], zones: [], edges: [] };

  // Zones: match by kind and name, in order.
  const usedZ = new Set<string>();
  const zoneIds: string[] = [];
  for (const tz of doc.zones) {
    const old = current.zones.find((z) => !usedZ.has(z.id) && z.kind === tz.kind && z.label === tz.name);
    const id = old ? old.id : nextId({ ...d, zones: [...d.zones, ...current.zones.filter((z) => !usedZ.has(z.id))] } as Diagram, 'z');
    usedZ.add(id);
    zoneIds.push(id);
    const parent = tz.parent === null ? undefined : zoneIds[tz.parent];
    const [w, h] = SIZE[tz.kind];
    const base: DZone = old ? { ...old } : { id, kind: tz.kind, label: tz.name, x: 0, y: 0, w, h };
    delete base.parent;
    delete base.access;
    d.zones.push({ ...base, label: tz.name, kind: tz.kind, ...(tz.access ? { access: tz.access } : {}), ...(parent ? { parent } : {}) });
  }

  // Blocks: match by id attribute, else by name, in order.
  const usedN = new Set<string>();
  const nodeIdOf = new Map<string, string>(); // text name (or @id) -> node id
  const fresh: string[] = [];
  for (const tb of doc.blocks) {
    const old = (tb.id ? current.nodes.find((n) => n.id === tb.id && !usedN.has(n.id)) : undefined) ?? current.nodes.find((n) => !usedN.has(n.id) && n.label === tb.name);
    const id = old ? old.id : tb.id && !current.nodes.some((n) => n.id === tb.id) && !d.nodes.some((n) => n.id === tb.id) ? tb.id : nextId({ ...d, nodes: [...d.nodes, ...current.nodes] } as Diagram, 'n');
    usedN.add(id);
    nodeIdOf.set(tb.id ? `@${tb.id}` : tb.name, id);
    if (tb.id) nodeIdOf.set(`@${tb.id}`, id);
    if (!nodeIdOf.has(tb.name)) nodeIdOf.set(tb.name, id);
    const zone = tb.zone === null ? undefined : zoneIds[tb.zone];
    const { zone: _z, product: _p, icon: _i, ...rest } = old ?? { id, role: tb.role, label: tb.name, x: 0, y: 0 };
    const product = { ...(old?.product ?? {}) };
    if (tb.product) product.oss = tb.product; else delete product.oss;
    const node: DNode = { ...rest, id, role: tb.role, label: tb.name, ...(zone ? { zone } : {}), ...(Object.keys(product).length ? { product } : {}), ...(tb.icon ? { icon: tb.icon } : {}) };
    if (!old) fresh.push(id);
    d.nodes.push(node);
  }

  // Connections: match by their two ends, keep ids.
  const usedE = new Set<string>();
  for (const te of doc.edges) {
    const from = nodeIdOf.get(te.from.byId ? `@${te.from.name}` : te.from.name)!, to = nodeIdOf.get(te.to.byId ? `@${te.to.name}` : te.to.name)!;
    if (!from || !to || from === to || d.edges.some((e) => e.from === from && e.to === to)) continue;
    const old = current.edges.find((e) => !usedE.has(e.id) && e.from === from && e.to === to);
    const id = old ? old.id : nextId({ ...d, edges: [...d.edges, ...current.edges] } as Diagram, 'e');
    usedE.add(id);
    const edge: DEdge = { ...(old ?? {}), id, from, to, kind: te.kind };
    if (te.label !== undefined && te.label !== '') edge.label = te.label; else delete edge.label;
    d.edges.push(edge);
  }

  d = placeByText(d, current, new Set(fresh));
  return d;
}

// ---------------------------------------------------------------- make positions agree with the text's nesting

const inRect = (z: DZone, x: number, y: number) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
const contains = (o: DZone, z: DZone) => z.x >= o.x && z.y >= o.y && z.x + z.w <= o.x + o.w && z.y + z.h <= o.y + o.h;

function depth(d: Diagram, z: DZone): number {
  let n = 0, p = z.parent;
  while (p !== undefined && n < 40) { n++; p = d.zones.find((o) => o.id === p)?.parent; }
  return n;
}

/** The innermost zone (by the file's nesting) whose rectangle holds the point. */
function innermost(d: Diagram, x: number, y: number): DZone | undefined {
  return d.zones.filter((z) => inRect(z, x, y)).sort((a, b) => depth(d, b) - depth(d, a) || a.w * a.h - b.w * b.h)[0];
}

/**
 * Move blocks and zones so that position agrees with the nesting the text gave, then grow every zone to hold what it
 * contains. New blocks go next to a block they connect to, or into a free spot in their zone; new zones go inside their
 * parent, or to the right of everything.
 */
function placeByText(d: Diagram, before: Diagram, fresh: Set<string>): Diagram {
  const zones = d.zones.map((z) => ({ ...z }));
  const nodes = d.nodes.map((n) => ({ ...n }));
  const work = (): Diagram => ({ ...d, zones, nodes });
  const isFreshZone = (z: DZone) => !before.zones.some((o) => o.id === z.id);
  const right = () => Math.max(0, ...nodes.filter((n) => !fresh.has(n.id)).map((n) => n.x + 3), ...zones.filter((z) => !isFreshZone(z)).map((z) => z.x + z.w + 2));

  // New zones: inside their parent (at its far side) or to the right of everything.
  for (const z of [...zones].sort((a, b) => depth(work(), a) - depth(work(), b))) {
    if (!isFreshZone(z)) continue;
    const parent = zones.find((p) => p.id === z.parent);
    if (parent) { z.x = parent.x + parent.w + 0.5; z.y = parent.y + 0.5; }
    else { z.x = right(); z.y = 0; }
  }

  const taken = (x: number, y: number, self: string) => nodes.some((n) => n.id !== self && !fresh.has(n.id) && Math.abs(n.x - x) < 2 && Math.abs(n.y - y) < 2) ||
    nodes.some((n) => n.id !== self && fresh.has(n.id) && n.x !== Infinity && Math.abs(n.x - x) < 2 && Math.abs(n.y - y) < 2);

  // A spot for a block in zone `zid` (or outside all zones), starting near (sx, sy).
  const spot = (self: string, zid: string | undefined, sx: number, sy: number): [number, number] => {
    const z = zones.find((o) => o.id === zid);
    const ok = (x: number, y: number) => {
      if (taken(x, y, self)) return false;
      const inner = innermost(work(), x, y);
      return zid ? inner?.id === zid : inner === undefined;
    };
    if (z) {
      for (let y = z.y + RADIUS; y <= z.y + z.h - RADIUS + 1e-9; y += 2) for (let x = z.x + RADIUS; x <= z.x + z.w - RADIUS + 1e-9; x += 2.5) if (ok(x, y)) return [x, y];
      // No room: grow the zone along x and use the new strip.
      const x = z.x + z.w + 1;
      z.w += 2.6;
      return [x, z.y + RADIUS];
    }
    // Outside every zone: the start point, then rings of points 2.5 cells apart around it.
    if (ok(sx, sy)) return [sx, sy];
    for (let r = 1; r < 20; r++) {
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const x = sx + dx * 2.5 * r, y = sy + dy * 2.5 * r;
        if (ok(x, y)) return [x, y];
      }
    }
    return [right(), sy];
  };

  // Blocks: put each where the text says it is.
  for (const n of nodes) {
    const want = n.zone;
    const isFresh = fresh.has(n.id);
    const inner = isFresh ? undefined : innermost(work(), n.x, n.y);
    if (!isFresh && (inner?.id ?? undefined) === want) continue;
    let sx = 0, sy = 0;
    const link = d.edges.map((e) => (e.from === n.id ? e.to : e.to === n.id ? e.from : null)).filter((x): x is string => !!x).map((id) => nodes.find((o) => o.id === id)).find((o) => o && !fresh.has(o.id));
    if (link) { sx = link.x + 2.5; sy = link.y; } else if (!want) { sx = right(); sy = 0; }
    if (isFresh) { n.x = Infinity; n.y = Infinity; }
    [n.x, n.y] = spot(n.id, want, sx, sy);
    fresh.delete(n.id);
  }

  // Grow zones (deepest first) to hold their blocks and inner zones.
  for (let pass = 0; pass < 3; pass++) {
    for (const z of [...zones].sort((a, b) => depth(work(), b) - depth(work(), a))) {
      let x0 = z.x, y0 = z.y, x1 = z.x + z.w, y1 = z.y + z.h;
      for (const n of nodes) if (n.zone === z.id) { x0 = Math.min(x0, n.x - RADIUS); y0 = Math.min(y0, n.y - RADIUS); x1 = Math.max(x1, n.x + RADIUS); y1 = Math.max(y1, n.y + RADIUS); }
      for (const c of zones) if (c.parent === z.id) { x0 = Math.min(x0, c.x - 0.5); y0 = Math.min(y0, c.y - 0.5); x1 = Math.max(x1, c.x + c.w + 0.5); y1 = Math.max(y1, c.y + c.h + 0.5); }
      // Touch the zone only when it must grow (recomputing an unchanged width can turn 7.2 into 7.200000000000001).
      if (x0 < z.x || y0 < z.y || x1 > z.x + z.w || y1 > z.y + z.h) {
        const r = (v: number) => Math.round(v * 1000) / 1000;
        z.x = r(x0); z.y = r(y0); z.w = r(x1 - x0); z.h = r(y1 - y0);
      }
    }
  }
  // A zone the text puts at the top level must not sit inside another zone's rectangle: move it to the right.
  for (const z of zones) if (z.parent === undefined && zones.some((o) => o.id !== z.id && contains(o, z)) && isFreshZone(z)) { z.x = right(); }
  return work();
}

/** Text -> diagram in one step, for callers that do not need the errors' positions. */
export function applyText(current: Diagram, text: string): { ok: true; diagram: Diagram } | { ok: false; errors: TextError[] } {
  const r = parseText(text);
  return r.ok ? { ok: true, diagram: mergeText(current, r.doc) } : r;
}
