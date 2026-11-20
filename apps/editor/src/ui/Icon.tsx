import { SPRITE, type LineIcon } from './sprite.ts';
import type { Shown } from '../catalog/packs.ts';

/** The hidden sprite of line icons and the connection arrowhead; rendered once at the root. Our own static markup. */
export function Sprite() {
  return <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<defs>${SPRITE}</defs>` }} />;
}

export function Icon({ name, className }: { name: LineIcon; className?: string }) {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** A product icon on its light sticker (palette, inspector). AWS icons fill it and take its rounded corners. */
export function ProductIcon({ s, large }: { s: Shown; large?: boolean }) {
  const cls = `ico${large ? ' ico--lg' : ''}${s.kind === 'aws' ? ' aws' : ''}`;
  return <span className={cls}>{s.icon ? <img src={s.icon} alt="" /> : <Icon name={s.line} />}</span>;
}
