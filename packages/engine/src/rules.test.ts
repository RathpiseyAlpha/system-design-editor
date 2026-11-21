import { describe, expect, it } from 'vitest';
import { checkDiagram, evaluateRules, parseRuleset, type Ruleset } from './rules.ts';
import { serializeDiagram, type Diagram } from './format.ts';
import { fromTemplate } from './templates.ts';

/** The four example rules of SPEC section 7. */
const EXAMPLE: Ruleset = {
  format: 'archboard-rules',
  version: 1,
  title: 'A web shop',
  rules: [
    { id: 'r1', points: 2, text: 'Users reach the app through a load balancer', rule: { path: ['client', 'load-balancer', ['vm', 'service', 'containers', 'kubernetes']] } },
    { id: 'r2', points: 2, text: 'The database is not in a public subnet', rule: { placement: { role: 'relational-db', notIn: { kind: 'subnet', access: 'public' } } } },
    { id: 'r3', points: 1, text: 'The app runs in at least two failure zones', rule: { spread: { roles: ['vm', 'service'], zoneKind: 'zone', min: 2 } } },
    { id: 'r4', points: 1, text: 'Users never talk to the database directly', rule: { noEdge: { from: 'client', to: 'relational-db' } } },
  ],
};

const run = (d: Diagram, rs: Ruleset = EXAMPLE) => evaluateRules(d, rs);
const passes = (d: Diagram, rs: Ruleset = EXAMPLE) => Object.fromEntries(run(d, rs).results.map((r) => [r.id, r.pass]));
const one = (rule: Ruleset['rules'][number]['rule']): Ruleset => ({ format: 'archboard-rules', version: 1, rules: [{ id: 'x', points: 1, text: 'x', rule }] });

/** Two failure zones in the shop's private side, one app server in each. */
function twoZones(): Diagram {
  const d = fromTemplate('three-tier');
  d.zones.push({ id: 'za', kind: 'zone', label: 'zone-a', parent: 'z3', x: 9, y: 1, w: 3, h: 4 }, { id: 'zb', kind: 'zone', label: 'zone-b', parent: 'z3', x: 9, y: 6, w: 3, h: 3.5 });
  d.nodes.find((n) => n.id === 'n3')!.zone = 'za';
  d.nodes.find((n) => n.id === 'n4')!.zone = 'zb';
  return d;
}

describe('the example rules of section 7', () => {
  it('the 3-tier template: a path, a private database, no failure zones yet, no direct link', () => {
    const r = run(fromTemplate('three-tier'));
    expect(r.results.map((x) => [x.id, x.pass])).toEqual([['r1', true], ['r2', true], ['r3', false], ['r4', true]]);
    expect([r.score, r.max, r.valid]).toEqual([5, 6, true]);
    expect(r.results[0]!.message).toBe('"Customers" > "web-lb" > "app-1".');
    expect(r.results[2]!.message).toBe('Virtual machine or Service stand in 0 failure zones; needs 2.');
  });

  it('a blank diagram scores 0: rules that only forbid something fail while there is nothing to check', () => {
    const r = run(fromTemplate('blank'));
    expect(r.results.every((x) => !x.pass)).toBe(true);
    expect(r.score).toBe(0);
    expect(r.results[1]!.message).toBe('There is no Relational database yet.');
    expect(r.results[3]!.message).toBe('Nothing to check yet: the diagram needs a Users.');
  });

  it('two failure zones, counted through the zone chain (a zone inside the subnet)', () => {
    const r = run(twoZones());
    expect(r.results.find((x) => x.id === 'r3')).toMatchObject({ pass: true, message: 'Virtual machine or Service stand in 2 failure zones ("zone-a", "zone-b"); needs 2.' });
    expect(r.score).toBe(6);
  });

  it('a database moved into the public subnet fails r2, and says where it is', () => {
    const d = fromTemplate('three-tier');
    d.nodes.find((n) => n.id === 'n5')!.zone = 'z2';
    expect(run(d).results[1]).toMatchObject({ pass: false, message: '"orders-db" is in "public-a", a public subnet.' });
  });

  it('a direct link between users and the database fails r4, in either direction unless oneWay', () => {
    const d = fromTemplate('three-tier');
    d.edges.push({ id: 'e9', from: 'n5', to: 'n1', kind: 'data' });
    expect(run(d).results[3]).toMatchObject({ pass: false, message: '"orders-db" > "Customers" connects them directly.' });
    expect(passes(d, one({ noEdge: { from: 'client', to: 'relational-db', oneWay: true } })).x).toBe(true);
  });

  it('removing the load balancer breaks the path, and the message says where the chain stops', () => {
    const d = fromTemplate('three-tier');
    d.edges = d.edges.filter((e) => e.id !== 'e3' && e.id !== 'e4');
    expect(run(d).results[0]).toMatchObject({ pass: false, message: '"Customers" > "web-lb" stops there: no connection from it to a Virtual machine, Service, Containers or 1 more.' });
  });

  it('labels, positions and the icon pack do not change any result', () => {
    const d = fromTemplate('three-tier');
    const base = run(d).results.map((r) => r.pass);
    const other: Diagram = { ...d, show: 'aws', nodes: d.nodes.map((n, i) => ({ ...n, label: `block ${i}`, x: n.x + 7, y: n.y - 3 })) };
    expect(run(other).results.map((r) => r.pass)).toEqual(base);
  });
});

describe('each rule kind', () => {
  const d = fromTemplate('three-tier');

  it('count: min, max, exact, and inside a kind of zone', () => {
    expect(passes(d, one({ count: { role: 'vm', min: 2 } })).x).toBe(true);
    expect(passes(d, one({ count: { role: 'vm', max: 1 } })).x).toBe(false);
    expect(run(d, one({ count: { role: ['vm', 'cache'], min: 3, max: 3, in: { kind: 'subnet', access: 'private' } } })).results[0]).toMatchObject({ pass: true, message: '3 Virtual machine or Cache inside a private subnet (needs exactly 3): "app-1", "app-2", "sessions".' });
    expect(passes(d, one({ count: { role: 'load-balancer', min: 1, in: { access: 'private' } } })).x).toBe(false);
  });

  it('path: follows direction, and can be limited to kinds of connection', () => {
    expect(passes(d, one({ path: ['vm', 'load-balancer'] })).x).toBe(false); // the connection runs lb > vm
    expect(passes(d, one({ path: ['relational-db', 'object-storage'], kinds: ['data'] })).x).toBe(true);
    expect(passes(d, one({ path: ['relational-db', 'object-storage'], kinds: ['request'] })).x).toBe(false);
  });

  it('placement: in a kind of zone, by the zone chain (the network holding the subnet counts)', () => {
    expect(passes(d, one({ placement: { role: 'relational-db', in: { kind: 'network' } } })).x).toBe(true);
    expect(run(d, one({ placement: { role: 'client', in: { kind: 'network' } } })).results[0]!.message).toBe('"Customers" is not inside a network.');
  });

  it('edgeKind: at least one connection, and all of them of that kind', () => {
    expect(passes(d, one({ edgeKind: { from: 'relational-db', to: 'object-storage', kind: 'data' } })).x).toBe(true);
    expect(run(d, one({ edgeKind: { from: 'vm', to: 'relational-db', kind: 'async' } })).results[0]).toMatchObject({ pass: false, message: '"app-1" > "orders-db" is a request; it should be an async message (and 1 more).' });
    expect(run(d, one({ edgeKind: { from: 'vm', to: 'queue', kind: 'async' } })).results[0]!.message).toBe('There is no connection from a Virtual machine to a Queue yet.');
  });

  it('a path search built to explode stays fast and exact', () => {
    // Eight layers of 7 services, every block linked to every block of the next layer, and the last step asks for a role
    // nobody has: millions of chains to try without remembering dead ends.
    const g: Diagram = { ...fromTemplate('blank'), nodes: [], edges: [] };
    for (let l = 0; l < 8; l++) for (let i = 0; i < 7; i++) g.nodes.push({ id: `n${l}_${i}`, role: 'service', label: `s${l}${i}`, x: l * 3, y: i * 3 });
    for (let l = 0; l < 7; l++) for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) g.edges.push({ id: `e${l}_${i}_${j}`, from: `n${l}_${i}`, to: `n${l + 1}_${j}`, kind: 'request' });
    const t = performance.now();
    const miss = run(g, one({ path: ['service', 'service', 'service', 'service', 'service', 'service', 'service', 'queue'] })).results[0]!;
    // Answered by remembering dead ends, not by running out of steps.
    expect(miss).toMatchObject({ pass: false, message: '"s00" > "s10" > "s20" > "s30" > "s40" > "s50" > "s60" stops there: no connection from it to a Queue.' });
    expect(passes(g, one({ path: ['service', 'service', 'service', 'service', 'service', 'service', 'service', 'service'] })).x).toBe(true);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('a ruleset is untrusted input', () => {
  it('reads the example', () => expect(parseRuleset(EXAMPLE).ok).toBe(true));
  it('refuses unknown roles, unknown fields, rules on labels, bad zones, repeated ids and too much', () => {
    const bad = (rule: unknown, extra: object = {}) => parseRuleset({ ...EXAMPLE, rules: [{ id: 'a', points: 1, text: 't', rule }], ...extra });
    expect(bad({ count: { role: 'mainframe', min: 1 } }).ok).toBe(false);
    expect(bad({ count: { role: 'vm', min: 1, label: 'app-1' } }).ok).toBe(false);
    expect(bad({ label: { is: 'web' } }).ok).toBe(false);
    expect(bad({ placement: { role: 'vm', in: { kind: 'network', access: 'public' } } }).ok).toBe(false);
    expect(bad({ count: { role: 'vm' } }).ok).toBe(false);
    expect(bad({ path: ['vm'] }).ok).toBe(false);
    expect(parseRuleset({ ...EXAMPLE, rules: [EXAMPLE.rules[0], EXAMPLE.rules[0]] })).toMatchObject({ ok: false, errors: [expect.stringContaining('used twice')] });
    expect(parseRuleset({ ...EXAMPLE, rules: Array.from({ length: 101 }, (_, i) => ({ ...EXAMPLE.rules[0], id: `r${i}` })) }).ok).toBe(false);
    expect(parseRuleset({ ...EXAMPLE, version: 2 }).ok).toBe(false);
    expect(parseRuleset(null).ok).toBe(false);
  });
});

describe('checkDiagram: the checker in one call', () => {
  it('takes the diagram as an object or as its text', () => {
    const d = fromTemplate('three-tier');
    const a = checkDiagram(JSON.parse(serializeDiagram(d)), EXAMPLE), b = checkDiagram(serializeDiagram(d), EXAMPLE);
    expect(a).toEqual(b);
    expect(a.ok && a.result.score).toBe(5);
  });
  it('a broken diagram is not valid and scores 0; a broken ruleset is an error', () => {
    expect(checkDiagram({ format: 'archboard', version: 1, nodes: [{ id: 'x' }] }, EXAMPLE)).toMatchObject({ ok: true, result: { valid: false, score: 0, max: 6, results: [] } });
    expect(checkDiagram(fromTemplate('blank'), { rules: [] })).toMatchObject({ ok: false });
  });
});
