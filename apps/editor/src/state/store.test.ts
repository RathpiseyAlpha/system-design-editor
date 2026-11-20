import { beforeEach, describe, expect, it } from 'vitest';
import { fromTemplate } from '@archboard/engine';
import { useEditor } from './store.ts';
import { zoneAt, freeSpot } from './ops.ts';

const S = () => useEditor.getState();

beforeEach(() => {
  S().load(fromTemplate('three-tier'));
});

describe('editing with history', () => {
  it('adds a block where asked, in the zone it lands in, and selects it', () => {
    S().add('cache', [12, 6]);
    const n = S().diagram.nodes.at(-1)!;
    expect(n.role).toBe('cache');
    expect(n.zone).toBe('z3');
    expect(S().selected).toBe(n.id);
  });

  it('never drops a new block on top of another', () => {
    S().add('vm', [10.2, 3]); // app-1 stands there
    const n = S().diagram.nodes.at(-1)!;
    expect(S().diagram.nodes.filter((o) => o.id !== n.id).some((o) => Math.abs(o.x - n.x) < 1.8 && Math.abs(o.y - n.y) < 1.8)).toBe(false);
  });

  it('moves a block into a different zone, and out of every zone', () => {
    S().move('n3', 5.5, 2);
    expect(S().diagram.nodes.find((n) => n.id === 'n3')!.zone).toBe('z2');
    S().move('n3', -6, -6);
    expect(S().diagram.nodes.find((n) => n.id === 'n3')!.zone).toBeUndefined();
  });

  it('deleting a block deletes its connections, and undo brings both back', () => {
    const edges = S().diagram.edges.length;
    S().remove(['n5']);
    expect(S().diagram.nodes.some((n) => n.id === 'n5')).toBe(false);
    expect(S().diagram.edges.some((e) => e.from === 'n5' || e.to === 'n5')).toBe(false);
    S().undo();
    expect(S().diagram.edges.length).toBe(edges);
    S().redo();
    expect(S().diagram.nodes.some((n) => n.id === 'n5')).toBe(false);
  });

  it('typing in one field is one undo step', () => {
    for (const label of ['o', 'or', 'ord', 'ordr']) S().update('n5', { label }, 'label:n5');
    expect(S().diagram.nodes.find((n) => n.id === 'n5')!.label).toBe('ordr');
    S().undo();
    expect(S().diagram.nodes.find((n) => n.id === 'n5')!.label).toBe('orders-db');
  });

  it('a new edit clears redo, and history keeps at most 100 steps', () => {
    S().move('n3', 9, 3);
    S().undo();
    S().move('n3', 11, 3);
    expect(S().future).toHaveLength(0);
    for (let i = 0; i < 120; i++) S().move('n3', 10 + (i % 2), 3);
    expect(S().past.length).toBe(100);
  });

  it('opening a broken file keeps the current diagram and names the problem', () => {
    const before = S().diagram;
    S().openText('{"format":"archboard","version":1,"nodes":[{"id":"a","role":"vm","label":"a","x":0,"y":0}],"edges":[{"id":"e","from":"a","to":"b"}]}', 'bad.json');
    expect(S().diagram).toBe(before);
    expect(S().notice?.kind).toBe('bad');
    expect(S().notice?.lines?.[0]).toContain('Connection "e" points to "b"');
  });

  it('changing the pack is remembered in the file', () => {
    S().setPack('aws');
    expect(S().diagram.show).toBe('aws');
  });
});

describe('zones and spots', () => {
  it('finds the innermost zone at a point', () => {
    const d = fromTemplate('three-tier');
    expect(zoneAt(d, 12, 5)?.id).toBe('z3');
    expect(zoneAt(d, 3.2, 0)?.id).toBe('z1');
    expect(zoneAt(d, -5, -5)).toBeUndefined();
  });
  it('a free spot is free', () => {
    const d = fromTemplate('three-tier');
    const [x, y] = freeSpot(d, 14, 3);
    expect(d.nodes.some((n) => Math.abs(n.x - x) < 1.8 && Math.abs(n.y - y) < 1.8)).toBe(false);
  });
});

describe('flat view', () => {
  it('switching to the flat view changes the view, never the file, and refits once', () => {
    const s = useEditor.getState(), before = s.diagram, key = s.docKey;
    s.setFlat(true);
    expect(useEditor.getState().flat).toBe(true);
    expect(useEditor.getState().diagram).toBe(before);
    expect(useEditor.getState().past).toHaveLength(s.past.length);
    expect(useEditor.getState().docKey).toBe(key + 1);
    useEditor.getState().setFlat(true);
    expect(useEditor.getState().docKey).toBe(key + 1);
    useEditor.getState().setFlat(false);
    expect(useEditor.getState().flat).toBe(false);
  });
});
