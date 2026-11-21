// The embed API (SPEC section 8.1), the parts that need no browser: reading the embed address and checking each message.
// A host page puts the editor in an iframe at /embed/?mode=view|edit|learn&origin=<host origin>. Messages are JSON
// {type, v: 1, ...}, sent only to that origin and accepted only from it. Everything a host sends is untrusted: a diagram goes
// through the same size limit and schema as a file opened from disk, a ruleset through the rule engine's schema, and a brief
// is Markdown drawn as a tree (never HTML).
import { parseDiagramText, parseRuleset, type Diagram, type Ruleset } from '@archboard/engine';
import { isPack, type PackId } from '../catalog/packs.ts';

export const EMBED_V = 1;
export type EmbedMode = 'view' | 'edit' | 'learn';
const MODES: EmbedMode[] = ['view', 'edit', 'learn'];
export const BRIEF_LIMITS = { label: 40, title: 120, text: 5000 } as const;

export interface EmbedConfig {
  /** True when the page was opened as an embed (the /embed path, or a mode in the address). */
  embed: boolean;
  mode: EmbedMode | null;
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
  const asked = q.get('mode') ?? 'view';
  const mode = (MODES as string[]).includes(asked) ? (asked as EmbedMode) : null;
  const origin = validOrigin(q.get('origin'));
  if (!mode) return { embed, mode: null, origin, problem: `There is no mode "${asked.slice(0, 20)}": use mode=view, mode=edit or mode=learn.` };
  if (!origin) return { embed, mode, origin: null, problem: 'This embed needs the host page’s origin in its address (origin=https://…).' };
  return { embed, mode, origin, problem: null };
}

export interface Brief { label?: string; title: string; text: string }

export type HostMessage =
  | { type: 'hello' }
  | { type: 'load'; diagram: Diagram; show: PackId | null; readOnly: boolean; brief: Brief | null; rules: Ruleset | null }
  | { type: 'setTheme'; theme: 'light' | 'dark' | 'system' }
  | { type: 'requestSave' };

/** A challenge's brief: a title, an optional short label ("Challenge 2") and Markdown text, each within its limit. */
function readBrief(b: unknown): { ok: true; brief: Brief } | { ok: false; error: string } {
  if (!b || typeof b !== 'object') return { ok: false, error: 'brief must be {title, text, label?}.' };
  const { label, title, text } = b as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim() || title.length > BRIEF_LIMITS.title) return { ok: false, error: `brief.title must be text of 1 to ${BRIEF_LIMITS.title} characters.` };
  if (typeof text !== 'string' || text.length > BRIEF_LIMITS.text) return { ok: false, error: `brief.text must be Markdown of at most ${BRIEF_LIMITS.text} characters.` };
  if (label !== undefined && (typeof label !== 'string' || label.length > BRIEF_LIMITS.label)) return { ok: false, error: `brief.label must be text of at most ${BRIEF_LIMITS.label} characters.` };
  return { ok: true, brief: { ...(label ? { label } : {}), title, text } };
}

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
    let brief: Brief | null = null, rules: Ruleset | null = null;
    if (m.brief !== undefined) {
      const b = readBrief(m.brief);
      if (!b.ok) return { ok: false, errors: [b.error] };
      brief = b.brief;
    }
    if (m.rules !== undefined) {
      const rs = parseRuleset(m.rules);
      if (!rs.ok) return { ok: false, errors: rs.errors.map((e) => `rules: ${e}`) };
      rules = rs.ruleset;
    }
    return { ok: true, msg: { type: 'load', diagram: r.diagram, show, readOnly: m.readOnly === true, brief, rules } };
  }
  if (m.type === 'hello') return { ok: true, msg: { type: 'hello' } };
  if (m.type === 'requestSave') return { ok: true, msg: { type: 'requestSave' } };
  if (m.type === 'setTheme') {
    return m.theme === 'light' || m.theme === 'dark' || m.theme === 'system'
      ? { ok: true, msg: { type: 'setTheme', theme: m.theme } }
      : { ok: false, errors: ['setTheme takes "light", "dark" or "system".'] };
  }
  return { ok: false, errors: [`Unknown message type "${String(m.type).slice(0, 30)}".`] };
}
