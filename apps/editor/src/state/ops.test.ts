import { describe, expect, it } from 'vitest';
import { fromTemplate, parseDiagram } from '@archboard/engine';
import { addEdge, addZone, deleteZone, moveZone, reassign, resizeZone, updateEdge, updateZone } from './ops.ts';

const shop = () => fromTemplate('three-tier');
const node = (d: ReturnType<typeof shop>, id: string) => d.nodes.find((n) => n.id === id)!;
const zone = (d: ReturnType<typeof shop>, id: string) => d.zones.find((z) => z.id === id)!;

describe('zones', () => {
  it('reassign agrees with the template as written', () => {
    const d = shop();
    expect(reassign(d)).toEqual(d);
  });

  it('a new zone nests in the zone around it and takes in the blocks it covers', () => {
    const { diagram: d, id } = addZone(shop(), 'zone', 12.2, 5); // a failure zone (7 x 5) wholly inside private-a
    expect(zone(d, id).parent).toBe('z3');
    expect(node(d, 'n3').zone).toBe(id); // app-1 at (10.2, 3) now stands in it
    expect(parseDiagram(d).ok).toBe(true);
  });

  it('a subnet gets an access setting, other kinds never do', () => {
    const { diagram: d, id } = addZone(shop(), 'subnet', 30, 30, 'public');
    expect(zone(d, id).access).toBe('public');
    const asGroup = updateZone(d, id, { kind: 'group' });
    expect(zone(asGroup, id).access).toBeUndefined();
    expect(zone(updateZone(asGroup, id, { kind: 'subnet' }), id).access).toBe('private');
  });

  it('moving a zone moves its zones and blocks with it, and nothing else', () => {
    const d = moveZone(shop(), 'z1', 2, -1);
    expect(zone(d, 'z3').x).toBe(8.6 + 2);
    expect(node(d, 'n5')).toMatchObject({ x: 16, y: 2, zone: 'z3' });
    expect(node(d, 'n1')).toMatchObject({ x: 0, y: 6 }); // Customers stands outside every zone
  });

  it('shrinking a zone lets out the blocks that no longer stand in it', () => {
    const d = resizeZone(shop(), 'z3', 3, 3); // private-a now ends before the database column
    expect(node(d, 'n5').zone).toBe('z1');
    expect(resizeZone(shop(), 'z3', 0.5, 0.5).zones.find((z) => z.id === 'z3')!.w).toBe(2); // at least 2 x 2 cells
  });

  it('deleting a zone keeps its blocks, which join the zone around it', () => {
    const d = deleteZone(shop(), 'z3');
    expect(d.nodes).toHaveLength(7);
    expect(node(d, 'n5').zone).toBe('z1');
  });
});

describe('connections', () => {
  it('connects two blocks once, never a block to itself or to nothing', () => {
    const first = addEdge(shop(), 'n6', 'n5');
    expect(first.id).toBe('e9');
    expect(addEdge(first.diagram, 'n6', 'n5').diagram.edges).toHaveLength(9); // the same connection again is not added
    expect(addEdge(shop(), 'n5', 'n5').id).toBeNull();
    expect(addEdge(shop(), 'n5', 'n99').id).toBeNull();
  });

  it('an empty label is removed rather than saved as ""', () => {
    const d = updateEdge(shop(), 'e1', { label: '' });
    expect('label' in d.edges[0]!).toBe(false);
    expect(updateEdge(shop(), 'e1', { kind: 'async' }).edges[0]!.kind).toBe('async');
  });
});
