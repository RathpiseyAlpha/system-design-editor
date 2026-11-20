import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from './markdown.ts';

describe('notes Markdown', () => {
  it('reads headings, paragraphs, lists, quotes and code', () => {
    const b = parseMarkdown('# Plan\n\nTwo web servers\nbehind a balancer.\n\n- one\n- two\n\n3. three\n4. four\n\n> why\n\n```\nx = 1\n```');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'pre']);
    expect(b[1]).toEqual({ t: 'p', c: [{ t: 'text', v: 'Two web servers behind a balancer.' }] });
    expect(b[3]).toMatchObject({ t: 'ol', start: 3 });
    expect(b[5]).toEqual({ t: 'pre', v: 'x = 1' });
  });

  it('reads inline code, bold, italic and https links', () => {
    expect(parseInline('a `b*c` **d** *e* [f](https://example.org/x)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'code', v: 'b*c' },
      { t: 'text', v: ' ' },
      { t: 'strong', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'e' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://example.org/x', c: [{ t: 'text', v: 'f' }] },
    ]);
  });

  it('never makes a link from an unsafe address: the words stay, the link goes', () => {
    for (const url of ['javascript:alert(1)', 'http://example.org', 'data:text/html,hi', '//example.org', 'https://a b', 'vbscript:x']) {
      expect(safeHref(url), url).toBeNull();
      expect(parseInline(`[click](${url})`).some((x) => x.t === 'link'), url).toBe(false);
    }
  });

  it('keeps HTML as text, and snake_case words are not emphasis', () => {
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([{ t: 'p', c: [{ t: 'text', v: '<script>alert(1)</script>' }] }]);
    expect(parseInline('app_server_1')).toEqual([{ t: 'text', v: 'app_server_1' }]);
  });

  it('an unclosed mark or fence is plain text, not an error', () => {
    expect(parseInline('**half')).toEqual([{ t: 'text', v: '**half' }]);
    expect(parseMarkdown('```\nopen')).toEqual([{ t: 'pre', v: 'open' }]);
    expect(parseMarkdown('')).toEqual([]);
  });
});
