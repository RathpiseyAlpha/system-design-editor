// Starting diagrams offered by "New diagram". Positions are ground grid cells (SPEC section 6).
import { emptyDiagram, type Diagram } from './format.ts';

export interface Template {
  id: string;
  name: string;
  description: string;
  diagram: Diagram;
}

const threeTier: Diagram = {
  format: 'archboard',
  version: 1,
  title: 'Online shop',
  show: 'generic',
  zones: [
    { id: 'z1', kind: 'network', label: 'shop-net', x: 3, y: -0.5, w: 13.5, h: 11 },
    { id: 'z2', kind: 'subnet', access: 'public', label: 'public-a', parent: 'z1', x: 3.8, y: 0.5, w: 3.8, h: 9.2 },
    { id: 'z3', kind: 'subnet', access: 'private', label: 'private-a', parent: 'z1', x: 8.6, y: 0.5, w: 7.2, h: 9.2 },
  ],
  nodes: [
    { id: 'n1', role: 'client', label: 'Customers', x: 0, y: 6 },
    { id: 'n7', role: 'object-storage', label: 'media', x: 0, y: 0.5 },
    { id: 'n2', role: 'load-balancer', label: 'web-lb', zone: 'z2', x: 5.7, y: 6 },
    { id: 'n3', role: 'vm', label: 'app-1', zone: 'z3', x: 10.2, y: 3 },
    { id: 'n4', role: 'vm', label: 'app-2', zone: 'z3', x: 10.2, y: 8 },
    { id: 'n5', role: 'relational-db', label: 'orders-db', zone: 'z3', x: 14, y: 3, product: { oss: 'postgresql' } },
    { id: 'n6', role: 'cache', label: 'sessions', zone: 'z3', x: 14, y: 8 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'request', label: 'HTTPS' },
    { id: 'e2', from: 'n1', to: 'n7', kind: 'request', label: 'images' },
    { id: 'e3', from: 'n2', to: 'n3', kind: 'request' },
    { id: 'e4', from: 'n2', to: 'n4', kind: 'request' },
    { id: 'e5', from: 'n3', to: 'n5', kind: 'request', label: 'SQL' },
    { id: 'e6', from: 'n4', to: 'n5', kind: 'request' },
    { id: 'e7', from: 'n4', to: 'n6', kind: 'request' },
    { id: 'e8', from: 'n5', to: 'n7', kind: 'data', label: 'backups' },
  ],
};

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank', description: 'An empty canvas.', diagram: emptyDiagram() },
  { id: 'three-tier', name: '3-tier web app', description: 'Users, a load balancer, two app servers, a database and a cache in one network.', diagram: threeTier },
];

/** A fresh copy of a template's diagram, safe to edit. */
export function fromTemplate(id: string): Diagram {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0]!;
  return structuredClone(t.diagram);
}
