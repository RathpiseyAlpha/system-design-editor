// The SVG parts of the canvas: pills, icon stickers, blocks, zones and connections. Ported from design/design-system.html.
import { memo, useId, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { roleInfo, type DNode, type DZone, type EdgeKind } from '@archboard/engine';
import { show, zoneLabel, type PackId, type Shown } from '../catalog/packs.ts';
import { P, IX, IY, RB, STK, SHAPES, FLAT, FLAT_CELL, isCyl, f, pts, rounded, pillWidth, type Pt } from './geometry.ts';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const cssVar = (name: string, value: string) => ({ [name]: value }) as CSSProperties;

export function Pill({ x, y, text, sub, icon, kind }: { x: number; y: number; text: string; sub?: string; icon?: string | null; kind?: 'warn' | 'bad' | 'ok' }) {
  const id = useId();
  const w = pillWidth(text, sub, Boolean(icon)), h = 22, x0 = x - w / 2, ic = icon ? 20 : 0;
  return (
    <g className={`pill${kind ? ' ' + kind : ''}`}>
      <rect className="shadow" x={f(x0 + 2)} y={f(y - h / 2 + 2)} width={f(w)} height={h} rx={11} />
      <rect className="face" x={f(x0)} y={f(y - h / 2)} width={f(w)} height={h} rx={11} />
      {icon && (
        <>
          <clipPath id={id}><rect x={f(x0 + 5)} y={f(y - 8)} width={16} height={16} rx={4} /></clipPath>
          <image href={icon} clipPath={`url(#${id})`} x={f(x0 + 5)} y={f(y - 8)} width={16} height={16} />
        </>
      )}
      <text x={f(x + ic / 2)} y={f(y + 0.5)}>
        {text}
        {sub && <tspan className="k">{`  ${sub}`}</tspan>}
      </text>
    </g>
  );
}

/** The light label on a block's top face: an AWS icon fills it (rounded corners), a logo sits inset, else a line icon. */
export function Sticker({ x, y, s }: { x: number; y: number; s: Shown }) {
  const id = useId();
  const h = STK / 2, x0 = x - h, y0 = y - h;
  return (
    <g className="sticker">
      <rect className="stk-sh" x={f(x0 + 1.5)} y={f(y0 + 1.5)} width={STK} height={STK} rx={7} />
      <rect className="stk" x={f(x0)} y={f(y0)} width={STK} height={STK} rx={7} />
      {s.kind === 'aws' && s.icon ? (
        <>
          <clipPath id={id}><rect x={f(x0)} y={f(y0)} width={STK} height={STK} rx={7} /></clipPath>
          <image href={s.icon} clipPath={`url(#${id})`} x={f(x0)} y={f(y0)} width={STK} height={STK} preserveAspectRatio="xMidYMid slice" />
          <rect className="stk-ring" x={f(x0)} y={f(y0)} width={STK} height={STK} rx={7} />
        </>
      ) : s.icon ? (
        <image href={s.icon} x={f(x0 + 5)} y={f(y0 + 5)} width={STK - 10} height={STK - 10} preserveAspectRatio="xMidYMid meet" />
      ) : (
        <use className="stk-line" href={`#i-${s.line}`} x={f(x - 9)} y={f(y - 9)} width={18} height={18} />
      )}
    </g>
  );
}

/**
 * The front of a rack server, drawn on the two visible faces of a box: grooves between three rack units, and in each unit
 * a status light and a drive bay on the left face and a vent slot on the right face. A point on a face is found by how far
 * along its bottom edge it is (t, 0 at the outer corner, 1 at the front corner) and how high above the ground (h).
 */
function ServerFront({ a, b, cx, cy, H }: { a: number; b: number; cx: number; cy: number; H: number }) {
  const UNITS = 3;
  const onLeft = (t: number, h: number): Pt => [cx - a + t * a, cy + t * b - h];
  const onRight = (t: number, h: number): Pt => [cx + a - t * a, cy + t * b - h];
  const out: ReactNode[] = [];
  for (let k = 1; k < UNITS; k++) {
    const h = (H * k) / UNITS;
    out.push(<polyline key={`g${k}`} className="groove" points={pts([onLeft(0, h), onLeft(1, h), onRight(0, h)])} />);
  }
  for (let i = 0; i < UNITS; i++) {
    const h = (H * (i + 0.5)) / UNITS;
    const [lx, ly] = onLeft(0.12, h);
    out.push(
      <ellipse key={`l${i}`} className="led" cx={f(lx)} cy={f(ly)} rx={2.3} ry={2.3} />,
      <polyline key={`d${i}`} className="bay" points={pts([onLeft(0.2, h), onLeft(0.36, h)])} />,
      <polyline key={`v${i}`} className="vent" points={pts([onRight(0.14, h + 2), onRight(0.4, h + 2)])} />,
      <polyline key={`w${i}`} className="vent" points={pts([onRight(0.14, h - 2), onRight(0.4, h - 2)])} />,
    );
  }
  return <>{out}</>;
}

interface BlockProps {
  node: DNode;
  pack: PackId;
  selected: boolean;
  /** Seen from above (the flat view): a card with a hard shadow instead of a solid. */
  flat?: boolean;
  onPointerDown?: (e: PointerEvent<SVGGElement>, id: string) => void;
  onKeyDown?: (e: KeyboardEvent<SVGGElement>, id: string) => void;
  /** Simulate mode: this second's utilisation (0.83 is 83 %) and whether the block is switched off. */
  load?: { util: number; failed: boolean };
}

/** Load status (SPEC 13.1): ok under 70 %, warn from 70 %, bad from 100 %; the label says it in words as well as colour. */
function loadStatus(load: BlockProps['load']): { st: 'ok' | 'warn' | 'bad'; text: string | null } | null {
  if (!load || load.failed) return null;
  const u = load.util, p = Math.round(u * 100);
  return u >= 1 ? { st: 'bad', text: `Over capacity ${p}%` } : u >= 0.7 ? { st: 'warn', text: `Busy ${p}%` } : { st: 'ok', text: null };
}

/** One block standing on its ground cell. Pointer events on the group: painter's order decides which block is on top. */
export const Block = memo(function Block({ node: n, pack, selected, flat, onPointerDown, onKeyDown, load }: BlockProps) {
  const clipId = useId();
  const r = roleInfo(n.role), sh = SHAPES[r.shape], sv = show(n.role, pack, n.product, n.icon);
  const [cx, cy] = flat ? FLAT.P(n.x, n.y) : P(n.x, n.y), H = sh.h, ty = cy - H;
  const parts: ReactNode[] = [];
  let labelY: number, ports: Pt[], topY: number;
  const status = loadStatus(load), fill = status ? Math.min(load!.util, 1) : 0;
  const off = !!load?.failed;

  if (flat) {
    // A card the size of the block's footprint (a disc for stores), with the neo-brutalist hard shadow. Servers keep their
    // dark face and show three status lights; the sticker sits in the middle, the name and kind under the card.
    const hs = (isCyl(sh) ? sh.r : sh.s) * FLAT_CELL;
    const shape = (cls: string, grow = 0, dx = 0) =>
      isCyl(sh) ? <circle className={cls} cx={f(cx + dx)} cy={f(cy + dx)} r={f(hs + grow)} />
        : <rect className={cls} x={f(cx - hs - grow + dx)} y={f(cy - hs - grow + dx)} width={f(2 * (hs + grow))} height={f(2 * (hs + grow))} rx={10 + grow} />;
    if (selected) parts.push(<g key="halo">{shape('halo', 2)}</g>);
    parts.push(<g key="sh">{shape('f-shadow', 0, 4)}</g>, <g key="face">{shape('left')}</g>);
    if (fill > 0) {
      const fh = 2 * hs * fill;
      parts.push(<clipPath key="fc" id={clipId}>{shape('')}</clipPath>, <rect key="load" className={`load ${status!.st}`} clipPath={`url(#${clipId})`} x={f(cx - hs)} y={f(cy + hs - fh)} width={f(2 * hs)} height={f(fh)} />);
    }
    parts.push(<g key="ol">{shape('ol')}</g>);
    if (isCyl(sh)) parts.push(<circle key="ring" className="ol thin" cx={f(cx)} cy={f(cy)} r={f(hs - 8)} />);
    if (r.shape === 'server') for (let i = 0; i < 3; i++) parts.push(<circle key={`led${i}`} className="led" cx={f(cx - hs + 12 + i * 9)} cy={f(cy + hs - 11)} r={2.6} />);
    labelY = cy + hs + 17;
    ports = [[cx - hs, cy], [cx + hs, cy]];
    return (
      <g
        className={`blk flat${r.shape === 'server' ? ' server' : ''}${off ? ' off' : ''}`}
        style={cssVar('--c', r.shape === 'server' ? 'var(--server)' : `var(--cat-${r.category})`)}
        data-block={n.id}
        tabIndex={0}
        role="button"
        aria-label={`${n.label}, ${r.name}${sv.kind !== 'line' ? `, shown as ${sv.name}` : ''}`}
        aria-pressed={selected}
        onPointerDown={onPointerDown ? (e) => onPointerDown(e, n.id) : undefined}
        onKeyDown={onKeyDown ? (e) => onKeyDown(e, n.id) : undefined}
      >
        {parts}
        <Sticker x={cx} y={r.shape === 'server' ? cy - 4 : cy} s={sv} />
        <text className="name" x={f(cx)} y={f(labelY)}>{clip(n.label, 16)}</text>
        <text className="sub" x={f(cx)} y={f(labelY + 14)}>{clip(sv.short, 16)}</text>
        {selected && ports.map(([x, y], i) => <rect key={i} className="port" data-port={n.id} x={f(x - 6)} y={f(y - 6)} width={12} height={12} rx={2.5}><title>Drag to another block to connect</title></rect>)}
        {status?.text && <Pill x={cx} y={cy - hs - 16} text={status.text} kind={status.st === 'bad' ? 'bad' : 'warn'} />}
        {off && <Pill x={cx} y={cy - hs - 16} text="Off" kind="bad" />}
      </g>
    );
  }

  if (isCyl(sh)) {
    const rx = Math.SQRT2 * sh.r * IX, ry = Math.SQRT2 * sh.r * IY;
    const side = `M${f(cx - rx)} ${f(ty)} L${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(cy)} L${f(cx + rx)} ${f(ty)}`;
    if (selected) parts.push(<path key="halo" className="halo" d={`${side} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx - rx)} ${f(ty)}`} />);
    parts.push(
      <path key="l" className="left" d={`${side} Z`} />,
      <path key="r" className="right" d={`M${f(cx)} ${f(ty + ry)} L${f(cx)} ${f(cy + ry)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(cy)} L${f(cx + rx)} ${f(ty)} Z`} />,
      <ellipse key="t" className="top" cx={f(cx)} cy={f(ty)} rx={f(rx)} ry={f(ry)} />,
      ...(fill > 0 ? [<path key="load" className={`load ${status!.st}`} d={`M${f(cx - rx)} ${f(cy - H * fill)} L${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(cy)} L${f(cx + rx)} ${f(cy - H * fill)} A${f(rx)} ${f(ry)} 0 0 1 ${f(cx - rx)} ${f(cy - H * fill)} Z`} />] : []),
      <path key="band" className="ol thin" d={`M${f(cx - rx)} ${f(ty + H * 0.5)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(ty + H * 0.5)}`} />,
      <path key="ol" className="ol" d={side} />,
      <ellipse key="olt" className="ol" cx={f(cx)} cy={f(ty)} rx={f(rx)} ry={f(ry)} />,
    );
    labelY = ty + ry + 17;
    ports = [[cx - rx, cy - H / 2], [cx + rx, cy - H / 2]];
    topY = ty - ry;
  } else {
    const a = 2 * sh.s * IX, b = 2 * sh.s * IY;
    const T = (dx: number, dy: number): Pt => [cx + dx, ty + dy], C = (dx: number, dy: number): Pt => [cx + dx, cy + dy];
    const hull = rounded([T(0, -b), T(a, 0), C(a, 0), C(0, b), C(-a, 0), T(-a, 0)], RB);
    if (selected) parts.push(<path key="halo" className="halo" d={hull} />);
    parts.push(
      <clipPath key="cp" id={clipId}><path d={hull} /></clipPath>,
      <path key="l" className="left" d={hull} />,
      <g key="faces" clipPath={`url(#${clipId})`}>
        <polygon className="right" points={pts([T(0, b), T(a + 2, 0), C(a + 2, 0), C(0, b + 2)])} />
        <polygon className="top" points={pts([T(0, -b - 2), T(a + 2, 0), T(0, b), T(-a - 2, 0)])} />
        {r.shape === 'server' && <ServerFront a={a} b={b} cx={cx} cy={cy} H={H} />}
        {fill > 0 && (
          <>
            <polygon className={`load ${status!.st}`} points={pts([C(-a - 2, 2), C(0, b + 2), C(0, b - H * fill), C(-a - 2, -H * fill)])} />
            <polygon className={`load ${status!.st}`} points={pts([C(0, b + 2), C(a + 2, 2), C(a + 2, -H * fill), C(0, b - H * fill)])} />
          </>
        )}
      </g>,
      <path key="ol" className="ol" d={hull} />,
      <polyline key="edge" className="ol" points={pts([T(-a + 1.2, 0), T(0, b), T(a - 1.2, 0)])} />,
      <line key="v" className="ol" x1={f(cx)} y1={f(ty + b)} x2={f(cx)} y2={f(cy + b - 1.2)} />,
    );
    labelY = ty + b + 13;
    ports = [[cx - a, cy - H / 2], [cx + a, cy - H / 2]];
    topY = ty - b;
  }

  const plate = r.shape === 'plate';
  const plateB = plate && !isCyl(sh) ? 2 * sh.s * IY : 0;
  return (
    <g
      className={`blk${r.shape === 'server' ? ' server' : ''}${off ? ' off' : ''}`}
      style={cssVar('--c', r.shape === 'server' ? 'var(--server)' : `var(--cat-${r.category})`)}
      data-block={n.id}
      tabIndex={0}
      role="button"
      aria-label={`${n.label}, ${r.name}${sv.kind !== 'line' ? `, shown as ${sv.name}` : ''}`}
      aria-pressed={selected}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, n.id) : undefined}
      onKeyDown={onKeyDown ? (e) => onKeyDown(e, n.id) : undefined}
    >
      {parts}
      <Sticker x={cx} y={ty} s={sv} />
      {plate ? (
        <Pill x={cx} y={cy + plateB + 20} text={clip(n.label, 16)} />
      ) : (
        <>
          <text className="name" x={f(cx)} y={f(labelY)}>{clip(n.label, 13)}</text>
          <text className="sub" x={f(cx)} y={f(labelY + 14)}>{clip(sv.short, 14)}</text>
        </>
      )}
      {selected && ports.map(([x, y], i) => <rect key={i} className="port" data-port={n.id} x={f(x - 6)} y={f(y - 6)} width={12} height={12} rx={2.5}><title>Drag to another block to connect</title></rect>)}
      {status?.text && <Pill x={cx} y={topY - 16} text={status.text} kind={status.st === 'bad' ? 'bad' : 'warn'} />}
      {off && <Pill x={cx} y={topY - 16} text="Off" kind="bad" />}
    </g>
  );
});

/** A zone: networks and regions are raised plates; subnets, failure zones and groups are dashed areas on the ground. */
export function ZoneShape({ z, selected, flat, off }: { z: DZone; selected?: boolean; flat?: boolean; off?: boolean }) {
  const c: Pt[] = [P(z.x, z.y), P(z.x + z.w, z.y), P(z.x + z.w, z.y + z.h), P(z.x, z.y + z.h)];
  const plate = z.kind === 'network' || z.kind === 'region';
  const v = z.kind === 'network' ? '--zone-vpc' : z.kind === 'region' || z.kind === 'zone' ? '--zone-region' : z.access === 'public' ? '--zone-public' : '--zone-private';
  const style = cssVar('--z', `var(${v})`);
  if (flat) {
    // From above: a rounded area; networks and regions solid with a hard shadow, the others dashed on the ground.
    const [x0, y0] = FLAT.P(z.x, z.y), [x1, y1] = FLAT.P(z.x + z.w, z.y + z.h), w = f(x1 - x0), h = f(y1 - y0);
    return (
      <g className={`zone flat${selected ? ' selected' : ''}${off ? ' off' : ''}`} style={style} data-zone={z.id}>
        {plate && <rect className="z-side" x={f(x0 + 5)} y={f(y0 + 5)} width={w} height={h} rx={12} />}
        <rect className="z-top" x={f(x0)} y={f(y0)} width={w} height={h} rx={12} />
        <rect className={`z-ol${plate ? '' : ' dash'}`} x={f(x0)} y={f(y0)} width={w} height={h} rx={12} />
      </g>
    );
  }
  if (!plate) {
    return (
      <g className={`zone${selected ? ' selected' : ''}${off ? ' off' : ''}`} style={style} data-zone={z.id}>
        <polygon className="z-top" points={pts(c)} />
        <polygon className="z-ol dash" points={pts(c)} />
      </g>
    );
  }
  const t = 10, d = (p: Pt): Pt => [p[0], p[1] + t];
  return (
    <g className={`zone${selected ? ' selected' : ''}${off ? ' off' : ''}`} style={style} data-zone={z.id}>
      <polygon className="z-side" points={pts([c[3]!, c[2]!, d(c[2]!), d(c[3]!)])} />
      <polygon className="z-side z-side-r" points={pts([c[2]!, c[1]!, d(c[1]!), d(c[2]!)])} />
      <polygon className="z-top" points={pts(c)} />
      <polygon className="z-ol" points={pts([c[0]!, c[1]!, d(c[1]!), d(c[2]!), d(c[3]!), c[3]!])} />
      <polyline className="z-ol" points={pts([c[3]!, c[2]!, c[1]!])} />
    </g>
  );
}

/** The zone's name tab: plates on their back edge, other zones on their front-left edge. */
/**
 * The zone's name tab, which is also its handle: drag it to move the zone with everything inside. Networks and regions label
 * their left corner (below the plate); other zones their right corner, where blocks rarely stand.
 */
export function ZoneTab({ z, pack, at, onPointerDown, onKeyDown, down }: { z: DZone; pack: PackId; at: Pt; onPointerDown?: (e: PointerEvent<SVGGElement>, id: string) => void; onKeyDown?: (e: KeyboardEvent<SVGGElement>, id: string) => void; down?: boolean }) {
  const { kind, icon } = zoneLabel(z.kind, z.access, pack);
  return (
    <g className="tab-handle" data-zone-tab={z.id} tabIndex={0} role="button" aria-label={`${z.label}, ${kind}`}
      onPointerDown={onPointerDown ? (e) => onPointerDown(e, z.id) : undefined} onKeyDown={onKeyDown ? (e) => onKeyDown(e, z.id) : undefined}>
      <title>Drag, or use the arrow keys, to move {z.label} and everything inside it. Shift and arrows change its size.</title>
      <Pill x={at[0]} y={at[1]} text={z.label} sub={down ? `${kind}, down` : kind} icon={icon} kind={down ? 'bad' : undefined} />
    </g>
  );
}

/** The width of a zone's tab, for label placement. */
export function zoneTabWidth(z: DZone, pack: PackId): number {
  const { kind, icon } = zoneLabel(z.kind, z.access, pack);
  return pillWidth(z.label, kind, Boolean(icon));
}

/** The resize handle at a selected zone's far corner. */
export function ZoneResize({ z, flat, onPointerDown }: { z: DZone; flat?: boolean; onPointerDown: (e: PointerEvent<SVGGElement>, id: string) => void }) {
  const [x, y] = (flat ? FLAT.P : P)(z.x + z.w, z.y + z.h);
  return (
    <g className="resize-handle" data-handle={z.id} onPointerDown={(e) => onPointerDown(e, z.id)}>
      <title>Drag to resize {z.label}</title>
      {flat ? <rect x={f(x - 8)} y={f(y - 8)} width={16} height={16} rx={3} /> : <polygon points={pts([[x, y - 9], [x + 15, y], [x, y + 9], [x - 15, y]])} />}
    </g>
  );
}

/** A connection, with a wide invisible stroke on top so it is easy to click. */
/** The point a fraction of the way along a polyline (for traffic dots). */
function along(points: Pt[], t: number): Pt {
  const seg = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]));
  let left = seg.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]! || i === seg.length - 1) {
      const k = seg[i]! ? Math.min(1, left / seg[i]!) : 0, a = points[i]!, b = points[i + 1]!;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    left -= seg[i]!;
  }
  return points[0]!;
}
const stillDots = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Wire({ id, points, kind, selected, name, onKeyDown, traffic }: { id: string; points: Pt[]; kind: EdgeKind; selected: boolean; name: string; onKeyDown?: (e: KeyboardEvent<SVGGElement>, id: string) => void; traffic?: { rate: number; dead: boolean } }) {
  // Simulate mode: dots move along a connection that carries traffic, more dots for more traffic (still under reduced
  // motion); a connection into something switched off, or cut, is dashed in the error colour and carries none.
  const dots = traffic && !traffic.dead && traffic.rate > 0 ? Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, traffic.rate)))) : 0;
  const path = `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')}`;
  return (
    <g className={`edge${selected ? ' selected' : ''}`} data-edge={id} tabIndex={0} role="button" aria-label={`Connection from ${name}, ${{ request: 'request', async: 'async message', data: 'data flow' }[kind]}`}
      onKeyDown={onKeyDown ? (e) => onKeyDown(e, id) : undefined}>
      <polyline className={`wire${traffic?.dead ? ' dead' : ''}`} data-kind={kind} points={pts(points)} markerEnd="url(#head)" />
      {Array.from({ length: dots }, (_, i) => {
        if (stillDots()) { const [x, y] = along(points, (i + 0.5) / dots); return <circle key={i} className="dot" cx={f(x)} cy={f(y)} r={4} />; }
        return <circle key={i} className="dot" r={4}><animateMotion dur="1.6s" repeatCount="indefinite" begin={`${(-1.6 * i) / dots}s`} path={path} /></circle>;
      })}
      <polyline className="wire-hit" points={pts(points)} />
    </g>
  );
}
