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

const staticWebsite: Diagram = {
  format: 'archboard', version: 1, title: 'Static website', show: 'generic',
  zones: [{ id: 'z1', kind: 'region', label: 'edge-and-storage', x: 3, y: -1, w: 11, h: 8 }],
  nodes: [
    { id: 'n1', role: 'client', label: 'Visitors', x: -1, y: 4 },
    { id: 'n2', role: 'dns', label: 'site-dns', zone: 'z1', x: 5, y: 0.5 },
    { id: 'n3', role: 'cdn', label: 'site-cdn', zone: 'z1', x: 5, y: 4 },
    { id: 'n4', role: 'object-storage', label: 'site-files', zone: 'z1', x: 11, y: 4 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'request', label: 'lookup' },
    { id: 'e2', from: 'n1', to: 'n3', kind: 'request', label: 'HTTPS' },
    { id: 'e3', from: 'n3', to: 'n4', kind: 'request', label: 'origin' },
  ],
};

const microservices: Diagram = {
  format: 'archboard', version: 1, title: 'Microservices', show: 'generic',
  zones: [
    { id: 'z1', kind: 'network', label: 'app-net', x: 2, y: -1, w: 18.5, h: 13 },
    { id: 'z2', kind: 'subnet', access: 'public', label: 'public-a', parent: 'z1', x: 2.5, y: 0, w: 3.5, h: 11 },
    { id: 'z3', kind: 'subnet', access: 'private', label: 'private-a', parent: 'z1', x: 6.5, y: 0, w: 13.5, h: 11 },
  ],
  nodes: [
    { id: 'n1', role: 'client', label: 'Users', x: -1.5, y: 5 },
    { id: 'n2', role: 'api-gateway', label: 'gateway', zone: 'z2', x: 4.2, y: 5 },
    { id: 'n3', role: 'service', label: 'orders', zone: 'z3', x: 8.5, y: 1.5 },
    { id: 'n4', role: 'service', label: 'catalog', zone: 'z3', x: 8.5, y: 5 },
    { id: 'n5', role: 'service', label: 'accounts', zone: 'z3', x: 8.5, y: 8.5 },
    { id: 'n6', role: 'relational-db', label: 'orders-db', zone: 'z3', x: 12.5, y: 1.5 },
    { id: 'n7', role: 'nosql-db', label: 'catalog-db', zone: 'z3', x: 12.5, y: 5 },
    { id: 'n8', role: 'relational-db', label: 'accounts-db', zone: 'z3', x: 12.5, y: 8.5 },
    { id: 'n9', role: 'queue', label: 'order-events', zone: 'z3', x: 17, y: 1.5 },
    { id: 'n10', role: 'service', label: 'notify', zone: 'z3', x: 17, y: 5.5 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'request', label: 'HTTPS' },
    { id: 'e2', from: 'n2', to: 'n3', kind: 'request' },
    { id: 'e3', from: 'n2', to: 'n4', kind: 'request' },
    { id: 'e4', from: 'n2', to: 'n5', kind: 'request' },
    { id: 'e5', from: 'n3', to: 'n6', kind: 'request' },
    { id: 'e6', from: 'n4', to: 'n7', kind: 'request' },
    { id: 'e7', from: 'n5', to: 'n8', kind: 'request' },
    { id: 'e8', from: 'n3', to: 'n9', kind: 'async', label: 'order placed' },
    { id: 'e9', from: 'n9', to: 'n10', kind: 'async' },
  ],
};

const serverlessApi: Diagram = {
  format: 'archboard', version: 1, title: 'Serverless API', show: 'generic',
  zones: [{ id: 'z1', kind: 'region', label: 'region-1', x: 2, y: -1.5, w: 13, h: 10.5 }],
  nodes: [
    { id: 'n1', role: 'client', label: 'App users', x: -1.5, y: 4 },
    { id: 'n2', role: 'identity', label: 'sign-in', zone: 'z1', x: 4.5, y: 0.5 },
    { id: 'n3', role: 'api-gateway', label: 'api', zone: 'z1', x: 4.5, y: 4 },
    { id: 'n4', role: 'function', label: 'orders-fn', zone: 'z1', x: 8.5, y: 2 },
    { id: 'n5', role: 'function', label: 'images-fn', zone: 'z1', x: 8.5, y: 6.5 },
    { id: 'n6', role: 'nosql-db', label: 'orders-table', zone: 'z1', x: 12.5, y: 2 },
    { id: 'n7', role: 'object-storage', label: 'images', zone: 'z1', x: 12.5, y: 6.5 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'request', label: 'sign in' },
    { id: 'e2', from: 'n1', to: 'n3', kind: 'request', label: 'HTTPS' },
    { id: 'e3', from: 'n3', to: 'n4', kind: 'request' },
    { id: 'e4', from: 'n3', to: 'n5', kind: 'request' },
    { id: 'e5', from: 'n4', to: 'n6', kind: 'request' },
    { id: 'e6', from: 'n5', to: 'n7', kind: 'request' },
  ],
};

const eventPipeline: Diagram = {
  format: 'archboard', version: 1, title: 'Event pipeline', show: 'generic',
  zones: [{ id: 'z1', kind: 'region', label: 'data-region', x: 2.5, y: -1, w: 13, h: 10 }],
  nodes: [
    { id: 'n1', role: 'device', label: 'Sensors', x: -1.5, y: 4 },
    { id: 'n2', role: 'stream', label: 'events', zone: 'z1', x: 5, y: 4 },
    { id: 'n3', role: 'function', label: 'enrich', zone: 'z1', x: 9, y: 1.5 },
    { id: 'n4', role: 'job', label: 'archiver', zone: 'z1', x: 9, y: 6.5 },
    { id: 'n5', role: 'warehouse', label: 'analytics', zone: 'z1', x: 13, y: 1.5 },
    { id: 'n6', role: 'object-storage', label: 'raw-archive', zone: 'z1', x: 13, y: 6.5 },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2', kind: 'async', label: 'readings' },
    { id: 'e2', from: 'n2', to: 'n3', kind: 'async' },
    { id: 'e3', from: 'n2', to: 'n4', kind: 'async' },
    { id: 'e4', from: 'n3', to: 'n5', kind: 'request', label: 'insert' },
    { id: 'e5', from: 'n4', to: 'n6', kind: 'data', label: 'archive' },
  ],
};

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank', description: 'An empty canvas.', diagram: emptyDiagram() },
  { id: 'static-website', name: 'Static website', description: 'Visitors, DNS, a CDN and the site files in object storage.', diagram: staticWebsite },
  { id: 'three-tier', name: '3-tier web app', description: 'Users, a load balancer, two app servers, a database and a cache in one network.', diagram: threeTier },
  { id: 'microservices', name: 'Microservices', description: 'An API gateway in front of three services, each with its own database, and an event queue.', diagram: microservices },
  { id: 'serverless-api', name: 'Serverless API', description: 'Sign-in, an API gateway, functions, a NoSQL table and object storage.', diagram: serverlessApi },
  { id: 'event-pipeline', name: 'Event pipeline', description: 'Devices stream events to processing, a warehouse and an archive.', diagram: eventPipeline },
];

/** A fresh copy of a template's diagram, safe to edit. */
export function fromTemplate(id: string): Diagram {
  const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0]!;
  return structuredClone(t.diagram);
}
