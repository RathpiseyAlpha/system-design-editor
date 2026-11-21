// Markdown drawn from parseMarkdown's tree as React elements: nothing in a note or a brief is ever read as HTML, and a link
// is drawn only for an https address (safeHref).
import { Fragment, type ReactNode } from 'react';
import type { Block, Inline } from './markdown.ts';

function inline(c: Inline[]): ReactNode {
  return c.map((x, i) => {
    switch (x.t) {
      case 'text': return <Fragment key={i}>{x.v}</Fragment>;
      case 'code': return <code key={i}>{x.v}</code>;
      case 'strong': return <strong key={i}>{inline(x.c)}</strong>;
      case 'em': return <em key={i}>{inline(x.c)}</em>;
      case 'link': return <a key={i} href={x.href} target="_blank" rel="noopener noreferrer">{inline(x.c)}</a>;
    }
  });
}

export function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'h': return b.level === 1 ? <h3 key={i}>{inline(b.c)}</h3> : b.level === 2 ? <h4 key={i}>{inline(b.c)}</h4> : <h5 key={i}>{inline(b.c)}</h5>;
    case 'p': return <p key={i}>{inline(b.c)}</p>;
    case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>;
    case 'ol': return <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>;
    case 'quote': return <blockquote key={i}>{inline(b.c)}</blockquote>;
    case 'pre': return <pre key={i}><code>{b.v}</code></pre>;
  }
}
