// The neutral catalog: every diagram is written in these roles and zone kinds. Icon packs only rename and re-icon them.
// roles.json is the single source; tools/fetch_icons.py reads it to build the pack manifest.
import core from './roles.json' with { type: 'json' };

export type Category = 'client' | 'network' | 'compute' | 'storage' | 'database' | 'messaging' | 'observe' | 'security';
export type Shape = 'box' | 'server' | 'low' | 'plate' | 'cyl';
export type ZoneKind = 'region' | 'network' | 'zone' | 'subnet' | 'group';

export interface RoleInfo {
  name: string;
  category: Category;
  shape: Shape;
}

export const ROLES = core.roles as Record<string, RoleInfo>;
export const ZONE_KINDS = core.zoneKinds as Record<ZoneKind, string>;
export const ZONE_KIND_IDS = Object.keys(ZONE_KINDS) as ZoneKind[];
export const CATEGORIES: Category[] = ['client', 'network', 'compute', 'storage', 'database', 'messaging', 'observe', 'security'];

export function isRole(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROLES, id);
}

export function roleInfo(id: string): RoleInfo {
  return ROLES[id] ?? { name: id, category: 'compute', shape: 'box' };
}

/** The closest role id to a mistyped one, for "Did you mean ...?" messages; null when nothing is close. */
export function nearestRole(id: string): string | null {
  return nearest(id.toLowerCase(), Object.keys(ROLES), Math.max(2, Math.floor(id.length / 4)));
}

/** The option closest to `word` by edit distance, if it is at most `limit` edits away; the first one wins a tie. */
export function nearest(word: string, options: Iterable<string>, limit: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const d = distance(word, o);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return bestD <= limit ? best : null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}
