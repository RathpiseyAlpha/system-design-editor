import { describe, expect, it } from 'vitest';
import { applyText, mergeText, parseText, printText } from './text.ts';
import { parseDiagram, type Diagram } from './format.ts';
import { TEMPLATES, fromTemplate } from './templates.ts';

const membership = (d: Diagram) => ({
  nodes: Object.fromEntries(d.nodes.map((n) => [n.id, n.zone ?? null])),
  zones: Object.fromEntries(d.zones.map((z) => [z.id, z.parent ?? null])),
});

/** The innermost zone each block stands in, by position (what the canvas shows). */
function byPosition(d: Diagram) {
  const depth = (id: string | undefined): number => (id ? 1 + depth(d.zones.find((z) => z.id === id)?.parent) : 0);
  return Object.fromEntries(
    d.nodes.map((n) => {
      const z = d.zones.filter((z) => n.x >= z.x && n.x <= z.x + z.w && n.y >= z.y && n.y <= z.y + z.h).sort((a, b) => depth(b.id) - depth(a.id))[0];
      return [n.id, z?.id ?? null];
    }),
  );
}

describe('diagram as code: print and parse', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s: print -> parse -> merge -> print gives the same text', (id) => {
    const d = fromTemplate(id);
    const text = printText(d);
    const r = applyText(d, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(printText(r.diagram)).toBe(text);
    expect(r.diagram).toEqual(d); // nothing was moved, renamed or lost
  });

  it('prints the 3-tier template as the spec shows it', () => {
    const text = printText(fromTemplate('three-tier'));
    expect(text).toContain('network shop-net {\n  subnet public-a public {\n    web-lb: load-balancer\n  }');
    expect(text).toContain('orders-db: relational-db [product: postgresql]');
    expect(text).toContain('orders-db .> media "backups"');
  });

  it('reads the syntax of the spec: lists of names, fan-out, async and data connections, comments', () => {
    const text = [
      'title "Shop"',
      'show aws',
      'Customers: client   // people',
      'network net {',
      '  subnet priv private {',
      '    app-1, app-2: vm',
      '    "orders db": relational-db [product: mysql]',
      '    jobs: queue',
      '  }',
      '}',
      'Customers > app-1, app-2 "HTTPS"',
      'app-1 ~> jobs',
      '"orders db" .> Customers',
    ].join('\n');
    const r = parseText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.blocks.map((b) => b.name)).toEqual(['Customers', 'app-1', 'app-2', 'orders db', 'jobs']);
    expect(r.doc.edges.map((e) => `${e.from.name}${e.kind}${e.to.name}`)).toEqual(['Customersrequestapp-1', 'Customersrequestapp-2', 'app-1asyncjobs', 'orders dbdataCustomers']);
    const d = mergeText(fromTemplate('blank'), r.doc);
    expect(parseDiagram(d).ok).toBe(true);
    expect(d.title).toBe('Shop');
    expect(d.nodes.find((n) => n.label === 'orders db')?.product).toEqual({ oss: 'mysql' });
  });

  it('tells blocks with the same name apart with [id: ...] and @id', () => {
    const d = fromTemplate('three-tier');
    d.nodes.find((n) => n.id === 'n4')!.label = 'app-1'; // two blocks called app-1
    const text = printText(d);
    expect(text).toContain('app-1: vm [id: n3]');
    expect(text).toContain('app-1: vm [id: n4]');
    expect(text).toContain('web-lb > @n4');
    const r = applyText(d, text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.diagram).toEqual(d);
  });

  it('quotes names that need it and reads them back', () => {
    const d = fromTemplate('three-tier');
    d.nodes[0]!.label = 'Web users "EU"';
    d.zones[0]!.label = 'network'; // a keyword as a name
    const r = applyText(d, printText(d));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.diagram).toEqual(d);
  });
});

describe('diagram as code: merging keeps what the text does not say', () => {
  it('keeps positions, notes and capacity of blocks the text still names; drops removed ones', () => {
    const d = fromTemplate('three-tier');
    d.nodes[3]!.notes = 'patch tuesday';
    d.nodes[3]!.sim = { instances: 2 };
    const text = printText(d).replace('    sessions: cache\n', '').replace('app-2 > sessions\n', '');
    const r = applyText(d, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.nodes.find((n) => n.id === d.nodes[3]!.id)).toEqual(d.nodes[3]);
    expect(r.diagram.nodes.some((n) => n.label === 'sessions')).toBe(false);
    expect(r.diagram.edges.some((e) => e.to === 'n6')).toBe(false);
  });

  it('a new block written inside a zone is placed inside it, and stays there by position', () => {
    const d = fromTemplate('three-tier');
    const text = printText(d).replace('    sessions: cache\n', '    sessions: cache\n    worker: function\n').replace('app-2 > sessions\n', 'app-2 > sessions\napp-2 ~> worker\n');
    const r = applyText(d, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = r.diagram.nodes.find((n) => n.label === 'worker')!;
    expect(w.zone).toBe('z3');
    expect(byPosition(r.diagram)).toEqual(membership(r.diagram).nodes);
    expect(parseDiagram(r.diagram).ok).toBe(true);
  });

  it('moving a block into another zone in the text moves it there on the canvas', () => {
    const d = fromTemplate('three-tier');
    const text = printText(d).replace('    web-lb: load-balancer\n', '    web-lb: load-balancer\n    sessions: cache\n').replace('    sessions: cache\n  }\n}', '  }\n}');
    const r = applyText(d, text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagram.nodes.find((n) => n.label === 'sessions')!.zone).toBe('z2');
    expect(byPosition(r.diagram)).toEqual(membership(r.diagram).nodes);
  });

  it('a new zone with blocks gets a place and holds them', () => {
    const d = fromTemplate('blank');
    const r = applyText(d, 'region eu {\n  network net {\n    api: service\n    db: relational-db\n  }\n}\napi > db');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(byPosition(r.diagram)).toEqual(membership(r.diagram).nodes);
    const [eu, net] = r.diagram.zones;
    expect(net!.parent).toBe(eu!.id);
    expect(eu!.x <= net!.x && eu!.y <= net!.y && eu!.x + eu!.w >= net!.x + net!.w && eu!.y + eu!.h >= net!.y + net!.h).toBe(true);
    expect(parseDiagram(r.diagram).ok).toBe(true);
  });
});

describe('diagram as code: errors on their line, with a fix when there is one', () => {
  const errs = (text: string) => { const r = parseText(text); return r.ok ? [] : r.errors; };

  it('an unknown role suggests the nearest one', () => {
    const [e] = errs('a: client\norders-db: relational-bd');
    expect(e).toMatchObject({ line: 2, from: 11, to: 24, message: 'There is no service called "relational-bd". Did you mean "relational-db"?', fix: { insert: 'relational-db' } });
  });
  it('a zone that is never closed', () => {
    expect(errs('network net {\n  a: vm')[0]).toMatchObject({ line: 1, message: 'This zone is never closed. Add } after its last line.' });
  });
  it('a } too many', () => {
    expect(errs('a: vm\n}')[0]).toMatchObject({ line: 2, message: expect.stringContaining('closes nothing') });
  });
  it('a connection to a block that is not declared', () => {
    expect(errs('a: vm\na > b')[0]).toMatchObject({ line: 2, from: 4, to: 5, message: expect.stringContaining('No block is called "b"') });
  });
  it('a name declared twice', () => {
    expect(errs('a: vm\na: cache')[0]).toMatchObject({ line: 2, message: expect.stringContaining('already declared on line 1') });
  });
  it('public on a zone that is not a subnet', () => {
    expect(errs('network n public {\n}')[0]).toMatchObject({ line: 1, message: expect.stringContaining('Only a subnet is public') });
  });
  it('an unclosed quote and a stray character', () => {
    expect(errs('"a: vm')[0]?.message).toContain('never closed');
    expect(errs('a: vm\na % b')[0]?.message).toContain('cannot be used here');
  });
});

describe('the diagram notes survive the text (decision 27)', () => {
  it('applying the printed text, and the text with a new block, keeps the notes', () => {
    const d: Diagram = { ...fromTemplate('three-tier'), notes: '# Why\nTwo app servers.' };
    const same = applyText(d, printText(d));
    expect(same.ok && same.diagram.notes).toBe(d.notes);
    const more = applyText(d, printText(d) + '\nextra-cache: cache\n');
    expect(more.ok && more.diagram.notes).toBe(d.notes);
    expect(more.ok && more.diagram.nodes.some((n) => n.label === 'extra-cache')).toBe(true);
  });
});
