// Highlighting for the diagram text (SPEC section 4): a small stream tokenizer, coloured from the design tokens so both
// themes work. The parser in packages/engine is the authority; this only colours.
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

const KEYWORDS = new Set(['title', 'show', 'region', 'network', 'zone', 'subnet', 'group', 'public', 'private']);

interface State { afterColon: boolean; inAttrs: boolean }

const diagramLanguage = StreamLanguage.define<State>({
  name: 'archboard',
  startState: () => ({ afterColon: false, inAttrs: false }),
  token(stream, state) {
    if (stream.sol()) { state.afterColon = false; state.inAttrs = false; }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol()) { const c = stream.next(); if (c === '\\') stream.next(); else if (c === '"') break; }
      return 'string';
    }
    if (stream.match(/^(~>|\.>|>)/)) return 'operator';
    if (stream.eat('[')) { state.inAttrs = true; return 'bracket'; }
    if (stream.eat(']')) { state.inAttrs = false; return 'bracket'; }
    if (stream.match(/^[{},]/)) return 'bracket';
    if (stream.eat(':')) { if (!state.inAttrs) state.afterColon = true; return 'punctuation'; }
    if (stream.match(/^@[A-Za-z0-9_.-]+/)) return 'labelName';
    const word = stream.match(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*/) as RegExpMatchArray | null;
    if (word) {
      if (state.inAttrs && stream.match(/^\s*:/, false)) return 'propertyName';
      if (state.afterColon) { state.afterColon = false; return 'typeName'; }
      if (KEYWORDS.has(word[0])) return 'keyword';
      return 'variableName';
    }
    stream.next();
    return 'invalid';
  },
  languageData: { commentTokens: { line: '//' } },
});

const style = HighlightStyle.define([
  { tag: t.keyword, fontWeight: '700', color: 'var(--ink)' },
  { tag: t.typeName, color: 'var(--marker-strong)', fontWeight: '600' },
  { tag: t.string, color: 'var(--warn)' },
  { tag: t.operator, color: 'var(--port)', fontWeight: '700' },
  { tag: t.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: t.labelName, color: 'var(--marker-strong)' },
  { tag: t.propertyName, color: 'var(--muted)' },
  { tag: t.invalid, color: 'var(--bad)' },
]);

/** The editor's look, from the tokens (light and dark follow the page's theme). */
const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--sunken)', color: 'var(--ink)', font: 'var(--t-code)' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--ink)', padding: '10px 0' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '22px' },
  '.cm-gutters': { backgroundColor: 'var(--sunken)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--marker) 14%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--marker) 45%, transparent) !important' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--bad)', textUnderlineOffset: '4px' },
  '.cm-tooltip': { backgroundColor: 'var(--sheet)', color: 'var(--ink)', border: '2px solid var(--edge)', borderRadius: '8px', font: '400 13px/19px var(--font-prose)' },
  '.cm-diagnostic-error': { borderLeft: '4px solid var(--bad)' },
  '.cm-diagnosticAction': { backgroundColor: 'var(--marker)', color: 'var(--marker-ink)', border: '1.5px solid var(--edge)', borderRadius: '6px', font: '600 12px/16px var(--font-mono)' },
});

export const diagramText = [diagramLanguage, syntaxHighlighting(style), theme];
