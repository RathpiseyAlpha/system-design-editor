// Icon packs: what each pack shows for a neutral role (SPEC section 5). Data comes from design/icons/manifest.json, written by
// tools/fetch_icons.py. Icon files are found at build time; a missing file (the AWS icons in a fresh clone or in CI) simply
// falls back to the generic line icon, so the editor never depends on them.
import { roleInfo, ZONE_KINDS, type ZoneKind } from '@archboard/engine';
import manifest from '../../../../design/icons/manifest.json';
import type { LineIcon } from '../ui/sprite.ts';

export type PackId = 'generic' | 'aws' | 'oss';
export const PACKS: { id: PackId; name: string }[] = [
  { id: 'generic', name: 'Generic' },
  { id: 'aws', name: 'AWS' },
  { id: 'oss', name: 'Open source' },
];
export const isPack = (v: string): v is PackId => PACKS.some((p) => p.id === v);

interface AwsProduct { name: string; short: string; icon: string }
interface OssProduct { id: string; name: string; short: string; licence: string; icon: string | null }
const AWS = manifest.packs.aws as unknown as { products: Record<string, AwsProduct>; groups: Record<string, { icon: string }>; zone_names: Record<string, string> };
const OSS = manifest.packs.oss as unknown as { products: Record<string, OssProduct[]> };

const FILES = import.meta.glob('../../../../design/icons/**/*.svg', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const iconUrl = (rel: string | null | undefined): string | null => (rel ? FILES[`../../../../design/icons/${rel}`] ?? null : null);

/** The generic pack's line icon and short label for each role. */
export const LINE: Record<string, LineIcon> = {
  client: 'users', mobile: 'phone', device: 'chip', external: 'plug', 'web-app': 'window', service: 'cube', job: 'clock', dns: 'globe', cdn: 'radio',
  'load-balancer': 'balance', 'api-gateway': 'gate', waf: 'shield', nat: 'route', vm: 'server', autoscaling: 'scale', containers: 'layers', kubernetes: 'wheel',
  function: 'fn', 'object-storage': 'bucket', 'block-storage': 'disk', 'file-storage': 'folder', 'relational-db': 'db', 'nosql-db': 'db', cache: 'bolt',
  search: 'search', warehouse: 'db', queue: 'queue', pubsub: 'radio', stream: 'wave', monitoring: 'chart', logs: 'note', identity: 'key', secrets: 'lock',
  registry: 'layers', custom: 'cube',
};
const SHORT: Record<string, string> = {
  client: 'Users', mobile: 'Mobile app', device: 'Device', external: 'External', 'web-app': 'Front end', service: 'Service', job: 'Batch job', dns: 'DNS', cdn: 'CDN',
  'load-balancer': 'Load balancer', 'api-gateway': 'API gateway', waf: 'Firewall', nat: 'NAT', vm: 'VM', autoscaling: 'Autoscaling', containers: 'Containers',
  kubernetes: 'Cluster', function: 'Function', 'object-storage': 'Object store', 'block-storage': 'Block store', 'file-storage': 'File store', 'relational-db': 'SQL database',
  'nosql-db': 'NoSQL', cache: 'Cache', search: 'Search', warehouse: 'Warehouse', queue: 'Queue', pubsub: 'Pub/sub', stream: 'Stream', monitoring: 'Metrics', logs: 'Logs',
  identity: 'Identity', secrets: 'Secrets', registry: 'Registry', custom: 'Custom',
};

export interface Shown {
  name: string;
  short: string;
  icon: string | null;
  kind: 'aws' | 'logo' | 'line';
  line: LineIcon;
  licence?: string;
}

/** What `pack` shows for `role`; `product` may pick one of a pack's products ({ oss: 'mysql' }). */
export function show(role: string, pack: PackId, product?: Record<string, string>, icon?: string): Shown {
  const line = (icon as LineIcon) || LINE[role] || 'cube';
  const generic: Shown = { name: roleInfo(role).name, short: SHORT[role] ?? roleInfo(role).name, icon: null, kind: 'line', line };
  if (pack === 'aws') {
    const p = AWS.products[role];
    if (!p) return generic;
    const url = iconUrl(p.icon);
    return { name: p.name, short: p.short, icon: url, kind: url ? 'aws' : 'line', line };
  }
  if (pack === 'oss') {
    const list = OSS.products[role] ?? [];
    const p = list.find((x) => x.id === product?.oss) ?? list[0];
    if (!p) return generic;
    const url = iconUrl(p.icon);
    return { name: p.name, short: p.short, icon: url, kind: url ? 'logo' : 'line', line, licence: p.licence };
  }
  return generic;
}

/** Every name a role goes by in any pack, for palette search ("s3", "minio", "bucket" all find object storage). */
export function searchText(role: string): string {
  const names = [role, roleInfo(role).name, SHORT[role] ?? '', AWS.products[role]?.name ?? '', AWS.products[role]?.short ?? '', ...(OSS.products[role] ?? []).flatMap((p) => [p.name, p.short])];
  return names.join(' ').toLowerCase();
}

/** The name a pack gives a zone kind, and its group icon when the pack has one. */
export function zoneLabel(kind: ZoneKind, access: string | undefined, pack: PackId): { kind: string; icon: string | null } {
  if (kind === 'subnet') return { kind: `${access ?? 'private'} subnet`, icon: pack === 'aws' ? iconUrl(AWS.groups[`subnet-${access ?? 'private'}`]?.icon) : null };
  const name = pack === 'aws' ? AWS.zone_names[kind] ?? ZONE_KINDS[kind] : ZONE_KINDS[kind];
  return { kind: name, icon: pack === 'aws' ? iconUrl(AWS.groups[kind]?.icon) : null };
}

/** The open-source products a role can be shown as (empty when the pack has none). */
export function ossProducts(role: string): { id: string; name: string; licence: string }[] {
  return (OSS.products[role] ?? []).map(({ id, name, licence }) => ({ id, name, licence }));
}
