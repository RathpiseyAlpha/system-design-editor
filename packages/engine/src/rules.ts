// The rule engine (SPEC section 7, M3). A ruleset is a challenge's checks: rules over roles, zones and connections, never
// over positions, labels or packs, so any pack and any layout of the same design gets the same result. The same code runs
// in the browser (live hints) and in the checker service (the judge), so the two can never disagree (decision 9).
//
// Meaning, fixed here and tested in rules.test.ts:
// - "Inside" follows the file's zone and parent chain (decision 21 keeps it equal to what the canvas shows). Any enclosing
//   zone counts: a database in a subnet is also in the network that holds the subnet.
// - A rule that only forbids something (noEdge, placement) fails while there is nothing to check: a blank diagram scores 0.
// - path follows the direction of connections, one direct connection per step, no block used twice; any kind of connection
//   unless the rule lists `kinds`. It does not forbid a shortcut: pair it with noEdge for that.
// - noEdge looks at both directions unless `oneWay` is set: "db > client" breaks "users never talk to the database" too.
// - edgeKind: at least one connection between the two roles exists, and every one of them is of that kind.
// - Results come in rule order; messages name blocks by label, in id order, so the same diagram always reads the same.
//
// A ruleset is untrusted input (the checker runs what a host sends): it is read through a zod schema with limits.
import { z } from 'zod';
import { isRole, roleInfo, ZONE_KIND_IDS, ZONE_KINDS, type ZoneKind } from './roles.ts';
import { parseDiagram, parseDiagramText, type Diagram, type DEdge, type DNode, type DZone, type EdgeKind } from './format.ts';

export const RULES_FORMAT = 'archboard-rules';
export const RULES_VERSION = 1;
const PATH_BUDGET = 200_000;
export const RULE_LIMITS = { rules: 100, roles: 20, path: 8, text: 200, hint: 300, title: 120 } as const;

const roleId = z.string().refine(isRole, { message: 'is not a role in the catalog' });
const roles = z.union([roleId, z.array(roleId).min(1).max(RULE_LIMITS.roles)]);
const edgeKind = z.enum(['request', 'async', 'data']);
const zoneMatch = z
  .object({ kind: z.enum(ZONE_KIND_IDS as [ZoneKind, ...ZoneKind[]]).optional(), access: z.enum(['public', 'private']).optional() })
  .strict()
  .refine((m) => m.kind !== undefined || m.access !== undefined, { message: 'name a zone kind, an access, or both' })
  .refine((m) => m.access === undefined || m.kind === undefined || m.kind === 'subnet', { message: 'only a subnet is public or private' });

const count = z.object({ count: z.object({ role: roles, min: z.number().int().min(0).max(200).optional(), max: z.number().int().min(0).max(200).optional(), in: zoneMatch.optional() }).strict()
  .refine((c) => c.min !== undefined || c.max !== undefined, { message: 'give min, max or both' })
  .refine((c) => c.min === undefined || c.max === undefined || c.min <= c.max, { message: 'min is more than max' }) }).strict();
const path = z.object({ path: z.array(roles).min(2).max(RULE_LIMITS.path), kinds: z.array(edgeKind).min(1).max(3).optional() }).strict();
const placement = z.object({ placement: z.object({ role: roles, in: zoneMatch.optional(), notIn: zoneMatch.optional() }).strict()
  .refine((p) => p.in || p.notIn, { message: 'give in, notIn or both' }) }).strict();
const spread = z.object({ spread: z.object({ roles, zoneKind: z.enum(ZONE_KIND_IDS as [ZoneKind, ...ZoneKind[]]), min: z.number().int().min(2).max(20) }).strict() }).strict();
const noEdge = z.object({ noEdge: z.object({ from: roles, to: roles, oneWay: z.boolean().optional() }).strict() }).strict();
const kindRule = z.object({ edgeKind: z.object({ from: roles, to: roles, kind: edgeKind }).strict() }).strict();

const ruleSchema = z.union([count, path, placement, spread, noEdge, kindRule]);
const entrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'ids use letters, digits, - and _ (at most 40)'),
  points: z.number().int().min(0).max(100),
  text: z.string().min(1).max(RULE_LIMITS.text),
  hint: z.string().max(RULE_LIMITS.hint).optional(),
  rule: ruleSchema,
}).strict();
export const rulesetSchema = z.object({
  format: z.literal(RULES_FORMAT),
  version: z.literal(RULES_VERSION),
  title: z.string().max(RULE_LIMITS.title).optional(),
  rules: z.array(entrySchema).min(1).max(RULE_LIMITS.rules),
}).strict().superRefine((rs, ctx) => {
  const seen = new Set<string>();
  rs.rules.forEach((r, i) => {
    if (seen.has(r.id)) ctx.addIssue({ code: 'custom', path: ['rules', i, 'id'], message: `"${r.id}" is used twice` });
    seen.add(r.id);
  });
});

export type Ruleset = z.infer<typeof rulesetSchema>;
export type RuleEntry = Ruleset['rules'][number];
export type Rule = RuleEntry['rule'];
type Roles = string | string[];
type ZoneMatch = z.infer<typeof zoneMatch>;

export type RulesetResult = { ok: true; ruleset: Ruleset } | { ok: false; errors: string[] };

/** Read a ruleset (an object, as a host or a file sends it). Every problem is reported with where it is. */
export function parseRuleset(data: unknown): RulesetResult {
  const r = rulesetSchema.safeParse(data);
  if (r.success) return { ok: true, ruleset: r.data };
  return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`) };
}

export interface RuleResult { id: string; pass: boolean; points: number; message: string }
/** The checker API's answer (SPEC section 8.2). `points` is what the rule is worth; `score` adds up the rules that pass. */
export interface CheckResult { valid: boolean; results: RuleResult[]; score: number; max: number; errors?: string[] }

// ---------------------------------------------------------------- reading the diagram

const list = (r: Roles) => (Array.isArray(r) ? r : [r]);
const roleName = (id: string) => roleInfo(id).name;
const rolesText = (r: Roles) => {
  const names = list(r).map(roleName);
  return names.length <= 3 ? names.join(' or ') : `${names.slice(0, 3).join(', ')} or ${names.length - 3} more`;
};
const KIND_TEXT: Record<EdgeKind, string> = { request: 'a request', async: 'an async message', data: 'a data flow' };
const zoneText = (m: ZoneMatch) => `${m.access ? `${m.access} ` : ''}${m.kind ? ZONE_KINDS[m.kind].toLowerCase() : 'zone'}`;
const names = (ns: DNode[]) => {
  const ls = ns.map((n) => `"${n.label}"`);
  return ls.length <= 4 ? ls.join(', ') : `${ls.slice(0, 4).join(', ')} and ${ls.length - 4} more`;
};

class View {
  readonly nodes: DNode[];
  readonly edges: DEdge[];
  private readonly zones = new Map<string, DZone>();
  private readonly byId = new Map<string, DNode>();

  constructor(d: Diagram) {
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.nodes = [...d.nodes].sort(byId);
    this.edges = [...d.edges].sort(byId);
    for (const z of d.zones) this.zones.set(z.id, z);
    for (const n of d.nodes) this.byId.set(n.id, n);
  }

  node(id: string) { return this.byId.get(id); }
  of(r: Roles) { const set = new Set(list(r)); return this.nodes.filter((n) => set.has(n.role)); }

  /** The zones around a block, innermost first, by the file's zone and parent chain. */
  around(n: DNode): DZone[] {
    const out: DZone[] = [];
    let id = n.zone;
    while (id !== undefined && out.length < 40) {
      const z = this.zones.get(id);
      if (!z || out.includes(z)) break;
      out.push(z);
      id = z.parent;
    }
    return out;
  }

  inside(n: DNode, m: ZoneMatch) { return this.around(n).find((z) => matches(z, m)); }
}

const matches = (z: DZone, m: ZoneMatch) => (m.kind === undefined || z.kind === m.kind) && (m.access === undefined || (z.kind === 'subnet' && (z.access ?? 'private') === m.access));

// ---------------------------------------------------------------- the rules

type Verdict = { pass: boolean; message: string };

function checkCount(v: View, r: z.infer<typeof count>['count']): Verdict {
  const found = v.of(r.role).filter((n) => !r.in || v.inside(n, r.in));
  const where = r.in ? ` inside any ${zoneText(r.in)}` : '';
  const need = r.min !== undefined && r.max !== undefined ? (r.min === r.max ? `exactly ${r.min}` : `${r.min} to ${r.max}`) : r.min !== undefined ? `at least ${r.min}` : `at most ${r.max}`;
  const pass = (r.min === undefined || found.length >= r.min) && (r.max === undefined || found.length <= r.max);
  return { pass, message: `${found.length} ${rolesText(r.role)}${where} (needs ${need})${found.length ? `: ${names(found)}` : ''}.` };
}

function checkPath(v: View, steps: Roles[], kinds?: EdgeKind[]): Verdict {
  const sets = steps.map((s) => new Set(list(s)));
  const allowed = (e: DEdge) => !kinds || kinds.includes(e.kind);
  const out = new Map<string, DEdge[]>();
  for (const e of v.edges) if (allowed(e)) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  // A dead end (block, step) is remembered, so a diagram built to make the search explode stays fast. Only a dead end that
  // never met an already used block is remembered: that one is a dead end whatever chain leads to it, so the answer is exact.
  const dead = new Set<string>();
  let best: DNode[] = [];
  let budget = PATH_BUDGET; // a fixed number of steps, the same in the browser and the checker, so both give the same answer
  const walk = (chain: DNode[]): { done: DNode[] | null; blocked: boolean } => {
    if (--budget < 0) return { done: null, blocked: true };
    if (chain.length > best.length) best = [...chain];
    if (chain.length === steps.length) return { done: chain, blocked: false };
    const last = chain[chain.length - 1]!, key = `${last.id}@${chain.length}`;
    if (dead.has(key)) return { done: null, blocked: false };
    let blocked = false;
    for (const e of out.get(last.id) ?? []) {
      const next = v.node(e.to);
      if (!next || !sets[chain.length]!.has(next.role)) continue;
      if (chain.includes(next)) { blocked = true; continue; }
      const r = walk([...chain, next]);
      if (r.done) return r;
      blocked ||= r.blocked;
    }
    if (!blocked) dead.add(key);
    return { done: null, blocked };
  };
  for (const start of v.nodes) {
    if (!sets[0]!.has(start.role)) continue;
    const { done } = walk([start]);
    if (done) return { pass: true, message: `${done.map((n) => `"${n.label}"`).join(' > ')}.` };
  }
  if (budget < 0) return { pass: false, message: 'The connections are too tangled to follow this chain: simplify the diagram.' };
  const via = kinds ? ` (${kinds.map((k) => KIND_TEXT[k]).join(' or ')})` : '';
  if (!best.length) return { pass: false, message: `There is no ${rolesText(steps[0]!)} block to start from yet.` };
  const last = best[best.length - 1]!;
  return { pass: false, message: `${best.length > 1 ? `${best.map((n) => `"${n.label}"`).join(' > ')} stops there` : `Nothing goes on from "${last.label}"`}: no connection${via} from it to any ${rolesText(steps[best.length]!)} block.` };
}

function checkPlacement(v: View, r: z.infer<typeof placement>['placement']): Verdict {
  const blocks = v.of(r.role);
  if (!blocks.length) return { pass: false, message: `There is no ${rolesText(r.role)} block yet.` };
  const problems: string[] = [];
  for (const n of blocks) {
    if (r.in && !v.inside(n, r.in)) problems.push(`"${n.label}" is not inside any ${zoneText(r.in)}`);
    const bad = r.notIn && v.inside(n, r.notIn);
    if (bad) problems.push(`"${n.label}" is in "${bad.label}", a ${zoneText({ kind: bad.kind, ...(bad.kind === 'subnet' ? { access: bad.access ?? 'private' } : {}) })}`);
  }
  if (problems.length) return { pass: false, message: `${problems.slice(0, 4).join('; ')}${problems.length > 4 ? `; and ${problems.length - 4} more` : ''}.` };
  return { pass: true, message: `${names(blocks)} ${blocks.length === 1 ? 'is' : 'are'} placed right.` };
}

function checkSpread(v: View, r: z.infer<typeof spread>['spread']): Verdict {
  const blocks = v.of(r.roles);
  const zones = new Map<string, DZone>();
  for (const n of blocks) for (const z of v.around(n)) if (z.kind === r.zoneKind) zones.set(z.id, z);
  const kind = ZONE_KINDS[r.zoneKind].toLowerCase();
  if (!blocks.length) return { pass: false, message: `There is no ${rolesText(r.roles)} block yet.` };
  const inZ = [...zones.values()].map((z) => `"${z.label}"`).join(', ');
  return { pass: zones.size >= r.min, message: `${rolesText(r.roles)} ${zones.size === 1 ? 'stands' : 'stand'} in ${zones.size} ${kind}${zones.size === 1 ? '' : 's'}${inZ ? ` (${inZ})` : ''}; needs ${r.min}.` };
}

function checkNoEdge(v: View, r: z.infer<typeof noEdge>['noEdge']): Verdict {
  const a = new Set(v.of(r.from).map((n) => n.id)), b = new Set(v.of(r.to).map((n) => n.id));
  if (!a.size || !b.size) return { pass: false, message: `Nothing to check yet: there is no ${rolesText(!a.size ? r.from : r.to)} block.` };
  const bad = v.edges.filter((e) => (a.has(e.from) && b.has(e.to)) || (!r.oneWay && b.has(e.from) && a.has(e.to)));
  if (!bad.length) return { pass: true, message: `No ${rolesText(r.from)} block is connected directly to any ${rolesText(r.to)} block.` };
  const show = bad.slice(0, 3).map((e) => `"${v.node(e.from)!.label}" > "${v.node(e.to)!.label}"`).join(', ');
  return { pass: false, message: `${show}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''} ${bad.length === 1 ? 'connects them' : 'connect them'} directly.` };
}

function checkEdgeKind(v: View, r: z.infer<typeof kindRule>['edgeKind']): Verdict {
  const a = new Set(v.of(r.from).map((n) => n.id)), b = new Set(v.of(r.to).map((n) => n.id));
  const between = v.edges.filter((e) => a.has(e.from) && b.has(e.to));
  if (!between.length) return { pass: false, message: `There is no connection from any ${rolesText(r.from)} block to any ${rolesText(r.to)} block yet.` };
  const wrong = between.filter((e) => e.kind !== r.kind);
  if (!wrong.length) return { pass: true, message: `${between.length === 1 ? 'The connection is' : `All ${between.length} connections are`} ${KIND_TEXT[r.kind]}.` };
  const e = wrong[0]!;
  return { pass: false, message: `"${v.node(e.from)!.label}" > "${v.node(e.to)!.label}" is ${KIND_TEXT[e.kind]}; it should be ${KIND_TEXT[r.kind]}${wrong.length > 1 ? ` (and ${wrong.length - 1} more)` : ''}.` };
}

function verdict(v: View, rule: Rule): Verdict {
  if ('count' in rule) return checkCount(v, rule.count);
  if ('path' in rule) return checkPath(v, rule.path, rule.kinds);
  if ('placement' in rule) return checkPlacement(v, rule.placement);
  if ('spread' in rule) return checkSpread(v, rule.spread);
  if ('noEdge' in rule) return checkNoEdge(v, rule.noEdge);
  return checkEdgeKind(v, rule.edgeKind);
}

/** Check a diagram that is already valid against a ruleset that is already read. */
export function evaluateRules(d: Diagram, rs: Ruleset): CheckResult {
  const v = new View(d);
  const results = rs.rules.map((r) => ({ id: r.id, points: r.points, ...verdict(v, r.rule) }));
  return { valid: true, results, score: results.reduce((s, r) => s + (r.pass ? r.points : 0), 0), max: rs.rules.reduce((s, r) => s + r.points, 0) };
}

/**
 * The checker's whole job, for untrusted input: read the diagram (object or text) and the ruleset, then check.
 * A diagram that is not valid scores nothing and says why; a ruleset that is not valid is the caller's mistake (an error).
 */
export function checkDiagram(diagram: unknown, ruleset: unknown): { ok: true; result: CheckResult } | { ok: false; errors: string[] } {
  const rs = parseRuleset(ruleset);
  if (!rs.ok) return { ok: false, errors: rs.errors.map((e) => `ruleset: ${e}`) };
  const max = rs.ruleset.rules.reduce((s, r) => s + r.points, 0);
  const d = typeof diagram === 'string' ? parseDiagramText(diagram) : parseDiagram(diagram);
  if (!d.ok) return { ok: true, result: { valid: false, results: [], score: 0, max, errors: d.errors } };
  return { ok: true, result: evaluateRules(d.diagram, rs.ruleset) };
}
