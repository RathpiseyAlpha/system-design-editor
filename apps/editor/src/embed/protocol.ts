// The embed API (SPEC section 8.1), the parts that need no browser: reading the embed address and checking each message.
// A host page puts the editor in an iframe at /embed/?mode=view&origin=<host origin>. Messages are JSON {type, v: 1, ...},
// sent only to that origin and accepted only from it. Everything a host sends is untrusted: a diagram goes through the same
// size limit and schema as a file opened from disk.
import { parseDiagramText, type Diagram } from '@archboard/engine';
import { isPack, type PackId } from '../catalog/packs.ts';

export const EMBED_V = 1;

export interface EmbedConfig {
  /** True when the page was opened as an embed (the /embed path, or a mode in the address). */
  embed: boolean;
  mode: 'view' | null;
  /** The host's origin, exactly as declared, when it is a valid one. */
  origin: string | null;
  /** Why the embed cannot start, in words for the page. */
  problem: string | null;
}

/** A host origin: https, or http on this computer (for development). Only the origin, no path. */
export function validOrigin(o: string | null): string | null {
  if (!o) return null;
  try {
    const u = new URL(o);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    return u.origin === o ? o : null;
  } catch {
    return null;
  }
}

export function readEmbed(pathname: string, search: string): EmbedConfig {
  const q = new URLSearchParams(search);
  const embed = /\/embed(\/(index\.html)?)?$/.test(pathname) || q.has('mode');
  if (!embed) return { embed: false, mode: null, origin: null, problem: null };
  const mode = q.get('mode') ?? 'view';
  const origin = validOrigin(q.get('origin'));
  if (mode !== 'view') return { embed, mode: null, origin, problem: `Mode "${mode.slice(0, 20)}" is not available yet: this version shows diagrams only (mode=view).` };
  if (!origin) return { embed, mode: 'view', origin: null, problem: 'This embed needs the host page’s origin in its address (origin=https://…).' };
  return { embed, mode: 'view', origin, problem: null };
}

export type HostMessage =
  | { type: 'load'; diagram: Diagram; show: PackId | null }
  | { type: 'setTheme'; theme: 'light' | 'dark' | 'system' };

/** Check one message from the host. Unknown or malformed messages come back as errors, never as actions. */
export function readHostMessage(data: unknown): { ok: true; msg: HostMessage } | { ok: false; errors: string[] } {
  if (!data || typeof data !== 'object') return { ok: false, errors: ['A message must be an object {type, v}.'] };
  const m = data as Record<string, unknown>;
  if (m.v !== EMBED_V) return { ok: false, errors: [`Unsupported message version ${String(m.v).slice(0, 10)}: this editor speaks v${EMBED_V}.`] };
  if (m.type === 'load') {
    let text: string;
    try {
      text = typeof m.diagram === 'string' ? m.diagram : JSON.stringify(m.diagram);
    } catch {
      return { ok: false, errors: ['The diagram could not be read.'] };
    }
    if (typeof text !== 'string') return { ok: false, errors: ['The load message has no diagram.'] };
    const r = parseDiagramText(text);
    if (!r.ok) return { ok: false, errors: r.errors };
    const show = typeof m.show === 'string' && isPack(m.show) ? m.show : null;
    return { ok: true, msg: { type: 'load', diagram: r.diagram, show } };
  }
  if (m.type === 'setTheme') {
    return m.theme === 'light' || m.theme === 'dark' || m.theme === 'system'
      ? { ok: true, msg: { type: 'setTheme', theme: m.theme } }
      : { ok: false, errors: ['setTheme takes "light", "dark" or "system".'] };
  }
  return { ok: false, errors: [`Unknown message type "${String(m.type).slice(0, 30)}".`] };
}
