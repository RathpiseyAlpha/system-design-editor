// The SVG parts of the canvas: pills, icon stickers, blocks, zones and connections. Ported from design/design-system.html.
import { memo, useId, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { roleInfo, type DNode, type DZone, type EdgeKind } from '@archboard/engine';
import { show, zoneLabel, type PackId, type Shown } from '../catalog/packs.ts';
import { P, IX, IY, RB, STK, SHAPES, isCyl, f, pts, rounded, pillWidth, type Pt } from './geometry.ts';

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
  onPointerDown?: (e: PointerEvent<SVGGElement>, id: string) => void;
  onKeyDown?: (e: KeyboardEvent<SVGGElement>, id: string) => void;
}

/** One block standing on its ground cell. Pointer events on the group: painter's order decides which block is on top. */
export const Block = memo(function Block({ node: n, pack, selected, onPointerDown, onKeyDown }: BlockProps) {
  const clipId = useId();
  const r = roleInfo(n.role), sh = SHAPES[r.shape], sv = show(n.role, pack, n.product, n.icon);
  const [cx, cy] = P(n.x, n.y), H = sh.h, ty = cy - H;
  const parts: ReactNode[] = [];
  let labelY: number, ports: Pt[];

  if (isCyl(sh)) {
    const rx = Math.SQRT2 * sh.r * IX, ry = Math.SQRT2 * sh.r * IY;
    const side = `M${f(cx - rx)} ${f(ty)} L${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(cy)} L${f(cx + rx)} ${f(ty)}`;
    if (selected) parts.push(<path key="halo" className="halo" d={`${side} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx - rx)} ${f(ty)}`} />);
    parts.push(
      <path key="l" className="left" d={`${side} Z`} />,
      <path key="r" className="right" d={`M${f(cx)} ${f(ty + ry)} L${f(cx)} ${f(cy + ry)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(cy)} L${f(cx + rx)} ${f(ty)} Z`} />,
      <ellipse key="t" className="top" cx={f(cx)} cy={f(ty)} rx={f(rx)} ry={f(ry)} />,
      <path key="band" className="ol thin" d={`M${f(cx - rx)} ${f(ty + H * 0.5)} A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx)} ${f(ty + H * 0.5)}`} />,
      <path key="ol" className="ol" d={side} />,
      <ellipse key="olt" className="ol" cx={f(cx)} cy={f(ty)} rx={f(rx)} ry={f(ry)} />,
    );
    labelY = ty + ry + 17;
    ports = [[cx - rx, cy - H / 2], [cx + rx, cy - H / 2]];
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
      </g>,
      <path key="ol" className="ol" d={hull} />,
      <polyline key="edge" className="ol" points={pts([T(-a + 1.2, 0), T(0, b), T(a - 1.2, 0)])} />,
      <line key="v" className="ol" x1={f(cx)} y1={f(ty + b)} x2={f(cx)} y2={f(cy + b - 1.2)} />,
    );
    labelY = ty + b + 13;
    ports = [[cx - a, cy - H / 2], [cx + a, cy - H / 2]];
  }

  const plate = r.shape === 'plate';
  const plateB = plate && !isCyl(sh) ? 2 * sh.s * IY : 0;
  return (
    <g
      className={`blk${r.shape === 'server' ? ' server' : ''}`}
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
      {selected && ports.map(([x, y], i) => <rect key={i} className="port" x={f(x - 4.5)} y={f(y - 4.5)} width={9} height={9} rx={2} />)}
    </g>
  );
});

/** A zone: networks and regions are raised plates; subnets, failure zones and groups are dashed areas on the ground. */
export function ZoneShape({ z }: { z: DZone }) {
  const c: Pt[] = [P(z.x, z.y), P(z.x + z.w, z.y), P(z.x + z.w, z.y + z.h), P(z.x, z.y + z.h)];
  const plate = z.kind === 'network' || z.kind === 'region';
  const v = z.kind === 'network' ? '--zone-vpc' : z.kind === 'region' || z.kind === 'zone' ? '--zone-region' : z.access === 'public' ? '--zone-public' : '--zone-private';
  const style = cssVar('--z', `var(${v})`);
  if (!plate) {
    return (
      <g className="zone" style={style} data-zone={z.id}>
        <polygon className="z-top" points={pts(c)} />
        <polygon className="z-ol dash" points={pts(c)} />
      </g>
    );
  }
  const t = 10, d = (p: Pt): Pt => [p[0], p[1] + t];
  return (
    <g className="zone" style={style} data-zone={z.id}>
      <polygon className="z-side" points={pts([c[3]!, c[2]!, d(c[2]!), d(c[3]!)])} />
      <polygon className="z-side z-side-r" points={pts([c[2]!, c[1]!, d(c[1]!), d(c[2]!)])} />
      <polygon className="z-top" points={pts(c)} />
      <polygon className="z-ol" points={pts([c[0]!, c[1]!, d(c[1]!), d(c[2]!), d(c[3]!), c[3]!])} />
      <polyline className="z-ol" points={pts([c[3]!, c[2]!, c[1]!])} />
    </g>
  );
}

/** The zone's name tab: plates on their back edge, other zones on their front-left edge. */
export function ZoneTab({ z, pack }: { z: DZone; pack: PackId }) {
  const plate = z.kind === 'network' || z.kind === 'region';
  const [mx, my] = plate ? P(z.x + Math.min(z.w * 0.3, 3), z.y) : P(z.x, z.y + Math.min(z.h * 0.5, 3.2));
  const { kind, icon } = zoneLabel(z.kind, z.access, pack);
  return <Pill x={mx + (plate ? 34 : -8)} y={my - 16} text={z.label} sub={kind} icon={icon} />;
}

export function Wire({ points, kind }: { points: Pt[]; kind: EdgeKind }) {
  return <polyline className="wire" data-kind={kind} points={pts(points)} markerEnd="url(#head)" />;
}
