import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, parseDiagram, parseDiagramText, serializeDiagram, nextId, emptyDiagram } from './format.ts';
import { ROLES, ZONE_KINDS } from './roles.ts';
import { TEMPLATES, fromTemplate } from './templates.ts';

const shop = () => fromTemplate('three-tier');

describe('diagram format v1', () => {
  it('accepts every template', () => {
    for (const t of TEMPLATES) expect(parseDiagram(t.diagram)).toMatchObject({ ok: true });
  });

  it('round-trips: save, open, save gives the same bytes', () => {
    const a = serializeDiagram(shop());
    const r = parseDiagramText(a);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeDiagram(r.diagram)).toBe(a);
  });

  it('drops unknown fields instead of failing', () => {
    const d = { ...shop(), extra: 1, nodes: shop().nodes.map((n) => ({ ...n, selected: true, measured: { w: 1 } })) };
    const r = parseDiagram(d);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('extra' in r.diagram).toBe(false);
      expect('selected' in r.diagram.nodes[0]!).toBe(false);
    }
  });

  it('keeps the optional sim fields (they are known v1 fields)', () => {
    const d = shop();
    d.nodes[3]!.sim = { instances: 2, capacity: 600, autoscale: { min: 2, max: 6, threshold: 0.7 } };
    d.edges[0]!.sim = { share: 0.5 };
    const r = parseDiagramText(serializeDiagram(d));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.diagram.nodes[3]!.sim).toEqual({ instances: 2, capacity: 600, autoscale: { min: 2, max: 6, threshold: 0.7 } });
      expect(r.diagram.edges[0]!.sim).toEqual({ share: 0.5 });
    }
  });

  it('names a connection that points nowhere', () => {
    const d = shop();
    d.edges[0]!.to = 'n99';
    const r = parseDiagram(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('Connection "e1" points to "n99"');
  });

  it('names an unknown role and suggests the nearest one', () => {
    const d = shop();
    d.nodes[5]!.role = 'relational-bd';
    const r = parseDiagram(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toBe('Block "n5" has the role "relational-bd", which is not in the catalog. Did you mean "relational-db"?');
  });

  it('refuses duplicate ids, missing zones and zone cycles', () => {
    const d = shop();
    d.nodes[1]!.id = 'n1';
    d.nodes[2]!.zone = 'z9';
    d.zones[0]!.parent = 'z2';
    const r = parseDiagram(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join(' | ');
      expect(all).toContain('The id "n1" is used twice.');
      expect(all).toContain('is in zone "z9"');
      expect(all).toContain('is inside itself');
    }
  });

  it('enforces the limits', () => {
    const d = shop();
    d.nodes[0]!.label = 'x'.repeat(LIMITS.label + 1);
    expect(parseDiagram(d).ok).toBe(false);
    expect(parseDiagramText('{').ok).toBe(false);
    expect(parseDiagramText(' '.repeat(LIMITS.bytes + 1)).ok).toBe(false);
  });

  it('refuses a file from a newer version with a plain message', () => {
    const r = parseDiagram({ ...shop(), version: 2 });
    expect(r).toEqual({ ok: false, errors: ['This file was made by a newer version of the editor (format version 2).'] });
  });

  it('gives new ids that are not taken', () => {
    expect(nextId(shop(), 'n')).toBe('n8');
    expect(nextId(emptyDiagram(), 'e')).toBe('e1');
  });
});

describe('catalog', () => {
  it('matches the icon manifest built by tools/fetch_icons.py (one source of roles)', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../design/icons/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.roles).toEqual(ROLES);
    expect(manifest.zone_kinds).toEqual(ZONE_KINDS);
  });
});
