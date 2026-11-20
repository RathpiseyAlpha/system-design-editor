// A small Markdown reader for diagram notes (SPEC section 4: notes are a Markdown document inside the file). It builds a plain
// tree that the notes panel turns into React elements, so nothing in a note is ever treated as HTML: a file from anyone is
// safe to open. Supported: headings (#, ##, ###), paragraphs, bulleted and numbered lists, quotes, fenced code, and inline
// code, bold, italic and links. Links work only for https:// addresses; anything else stays as plain text.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][]; start: number }
  | { t: 'quote'; c: Inline[] }
  | { t: 'pre'; v: string };

/** Only absolute https addresses become links. */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (!/^https:\/\/[^\s<>"']+$/i.test(u)) return null;
  try {
    return new URL(u).protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** Inline marks, read left to right; an unclosed mark is plain text. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => { if (text) { out.push({ t: 'text', v: text }); text = ''; } };
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length && /[\\`*_[\]()#>-]/.test(s[i + 1]!)) { text += s[i + 1]; i += 2; continue; }
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    }
    if ((ch === '*' || ch === '_') && s[i + 1] === ch) {
      const j = s.indexOf(ch + ch, i + 2);
      if (j > i + 2) { flush(); out.push({ t: 'strong', c: parseInline(s.slice(i + 2, j)) }); i = j + 2; continue; }
    }
    if (ch === '*' || ch === '_') {
      const j = s.indexOf(ch, i + 1);
      // `_` inside a word (snake_case) is not emphasis.
      const wordBefore = ch === '_' && i > 0 && /\w/.test(s[i - 1]!);
      if (j > i + 1 && !wordBefore && s[i + 1] !== ' ') { flush(); out.push({ t: 'em', c: parseInline(s.slice(i + 1, j)) }); i = j + 1; continue; }
    }
    if (ch === '[') {
      const close = s.indexOf('](', i + 1);
      const end = close > i ? s.indexOf(')', close + 2) : -1;
      if (close > i && end > close) {
        const label = s.slice(i + 1, close), href = safeHref(s.slice(close + 2, end));
        flush();
        if (href) out.push({ t: 'link', href, c: parseInline(label) });
        else out.push(...parseInline(label)); // not a safe address: keep the words, drop the link
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*?)\s*#*\s*$/;

/** Read a whole note into blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      i++; // the closing fence (or the end of the note)
      out.push({ t: 'pre', v: body.join('\n') });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) { out.push({ t: 'h', level: h[1]!.length as 1 | 2 | 3, c: parseInline(h[2]!) }); i++; continue; }
    if (BULLET.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && BULLET.test(lines[i]!)) items.push(parseInline(BULLET.exec(lines[i++]!)![1]!));
      out.push({ t: 'ul', items });
      continue;
    }
    if (NUMBER.test(line)) {
      const start = Number(NUMBER.exec(line)![1]);
      const items: Inline[][] = [];
      while (i < lines.length && NUMBER.test(lines[i]!)) items.push(parseInline(NUMBER.exec(lines[i++]!)![2]!));
      out.push({ t: 'ol', items, start });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', c: parseInline(body.join(' ')) });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !HEADING.test(lines[i]!) && !BULLET.test(lines[i]!) && !NUMBER.test(lines[i]!) && !/^\s*(```|>)/.test(lines[i]!)) body.push(lines[i++]!.trim());
    out.push({ t: 'p', c: parseInline(body.join(' ')) });
  }
  return out;
}
