// The 3D canvas: an SVG scene in painter's order inside one transformed group. d3-zoom pans and zooms that group directly
// (no React render per frame); a press on a block never starts a pan.
import { useCallback, useEffect, useMemo, useRef, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom';
import type { Diagram, DZone } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { Block, Pill, Wire, ZoneShape, ZoneTab } from './parts.tsx';
import { P, LIFT, bounds, paintOrder, route, snap, toGround, f, type Pt } from './geometry.ts';

export const ROLE_MIME = 'application/x-archboard-role';
const ARROWS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
import { Icon } from '../ui/Icon.tsx';

const ZOOM_MIN = 0.25, ZOOM_MAX = 2.5;

function Grid() {
  const lines: Pt[][] = [];
  for (let k = -30; k <= 60; k++) lines.push([P(k, -30), P(k, 60)], [P(-30, k), P(60, k)]);
  return (
    <g className="grid" aria-hidden="true">
      {lines.map(([a, b], i) => <line key={i} className="gridline" x1={f(a![0])} y1={f(a![1])} x2={f(b![0])} y2={f(b![1])} />)}
    </g>
  );
}

/** Zones ordered so that a parent is painted before what is inside it. */
function zoneDepthOrder(zones: DZone[]): DZone[] {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const depth = (z: DZone): number => {
    let d = 0, p = z.parent;
    while (p !== undefined && byId.has(p) && d < 40) { d++; p = byId.get(p)!.parent; }
    return d;
  };
  return [...zones].sort((a, b) => depth(a) - depth(b));
}

interface SceneProps {
  d: Diagram;
  onBlockPointerDown: (e: PointerEvent<SVGGElement>, id: string) => void;
  onBlockKeyDown: (e: KeyboardEvent<SVGGElement>, id: string) => void;
}

function Scene({ d: doc, onBlockPointerDown, onBlockKeyDown }: SceneProps) {
  const pack = useEditor((s) => s.pack);
  const selected = useEditor((s) => s.selected);
  const drag = useEditor((s) => s.drag);
  // While a block is dragged it is drawn (with its connections) at the drag position; the file changes only on drop.
  const d = useMemo(
    () => (drag ? { ...doc, nodes: doc.nodes.map((n) => (n.id === drag.id ? { ...n, x: drag.x, y: drag.y } : n)) } : doc),
    [doc, drag],
  );
  const byId = useMemo(() => new Map(d.nodes.map((n) => [n.id, n])), [d.nodes]);
  const wires = useMemo(
    () =>
      d.edges.flatMap((e) => {
        const a = byId.get(e.from), b = byId.get(e.to);
        if (!a || !b) return [];
        const screen = route(a, b, d.nodes).map(([gx, gy]): Pt => { const [x, y] = P(gx, gy); return [x, y - LIFT]; });
        let best = 0, at: Pt = [0, 0];
        for (let i = 1; i < screen.length; i++) {
          const [p, q] = [screen[i - 1]!, screen[i]!], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (L > best) { best = L; at = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }
        }
        return [{ e, screen, at }];
      }),
    [d.edges, d.nodes, byId],
  );
  const zones = useMemo(() => zoneDepthOrder(d.zones), [d.zones]);
  const nodes = useMemo(() => [...d.nodes].sort(paintOrder), [d.nodes]);

  return (
    <>
      {zones.map((z) => <ZoneShape key={z.id} z={z} />)}
      {wires.map(({ e, screen }) => <Wire key={e.id} points={screen} kind={e.kind} />)}
      {nodes.map((n) => (
        <Block
          key={n.id}
          node={n}
          pack={pack}
          selected={selected === n.id}
          onPointerDown={onBlockPointerDown}
          onKeyDown={onBlockKeyDown}
        />
      ))}
      {zones.map((z) => <ZoneTab key={z.id} z={z} pack={pack} />)}
      {wires.filter((w) => w.e.label).map(({ e, at }) => <Pill key={e.id} x={at[0]} y={at[1]} text={e.label!} />)}
    </>
  );
}

export function Canvas() {
  const diagram = useEditor((s) => s.diagram);
  const docKey = useEditor((s) => s.docKey);
  const select_ = useEditor((s) => s.select);
  const add = useEditor((s) => s.add);
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<SVGGElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const diagramRef = useRef(diagram);
  diagramRef.current = diagram;

  useEffect(() => {
    const svg = svgRef.current!;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .filter((ev: Event) => {
        if (ev.type === 'wheel') return true;
        const target = ev.target as Element | null;
        return !(ev as MouseEvent).button && !target?.closest('[data-block]');
      })
      .on('zoom', (ev) => {
        layerRef.current?.setAttribute('transform', ev.transform.toString());
        if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(ev.transform.k * 100)}%`;
      });
    select(svg).call(z).on('dblclick.zoom', null);
    zoomRef.current = z;
    // Tell the store where the middle of the visible canvas is, for blocks added from the palette.
    useEditor.setState({
      viewCenter: () => {
        const [sx, sy] = zoomTransform(svg).invert([svg.clientWidth / 2, svg.clientHeight / 2]);
        const [gx, gy] = toGround(sx, sy);
        return [snap(gx), snap(gy)];
      },
    });
    return () => { select(svg).on('.zoom', null); };
  }, []);

  /** The ground cell under a point of the window. */
  const groundAt = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!, rect = svg.getBoundingClientRect();
    const [sx, sy] = zoomTransform(svg).invert([clientX - rect.left, clientY - rect.top]);
    const [gx, gy] = toGround(sx, sy);
    return [snap(gx), snap(gy)];
  };

  // Drag a block: snap to half cells, draw it at the drag position, commit once on drop (one undo step).
  const onBlockPointerDown = useCallback((e: PointerEvent<SVGGElement>, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const st = useEditor.getState();
    st.select(id);
    const node = st.diagram.nodes.find((n) => n.id === id);
    const svg = svgRef.current;
    if (!node || !svg) return;
    const k = zoomTransform(svg).k, x0 = e.clientX, y0 = e.clientY;
    let to: [number, number] = [node.x, node.y];
    const onMove = (ev: globalThis.PointerEvent) => {
      const [dgx, dgy] = toGround((ev.clientX - x0) / k, (ev.clientY - y0) / k);
      const next: [number, number] = [snap(node.x + dgx), snap(node.y + dgy)];
      if (next[0] !== to[0] || next[1] !== to[1]) { to = next; useEditor.getState().setDrag({ id, x: to[0], y: to[1] }); }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const s = useEditor.getState();
      s.setDrag(null);
      if (to[0] !== node.x || to[1] !== node.y) s.move(id, to[0], to[1]);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  // Keyboard on a focused block: Enter or Space selects, arrows move one cell along the grid, Delete removes it.
  const onBlockKeyDown = useCallback((e: KeyboardEvent<SVGGElement>, id: string) => {
    const s = useEditor.getState();
    const step = ARROWS[e.key];
    if (e.key === 'Enter' || e.key === ' ') s.select(id);
    else if (step) {
      const n = s.diagram.nodes.find((x) => x.id === id);
      if (n) { s.select(id); s.move(id, n.x + step[0], n.y + step[1]); }
    } else if (e.key === 'Delete' || e.key === 'Backspace') s.remove([id]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(ROLE_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const role = e.dataTransfer.getData(ROLE_MIME);
    if (!role) return;
    e.preventDefault();
    add(role, groundAt(e.clientX, e.clientY));
  };

  const fit = useCallback(() => {
    const svg = svgRef.current, z = zoomRef.current;
    if (!svg || !z) return;
    const b = bounds(diagramRef.current), W = svg.clientWidth, H = svg.clientHeight, pad = 48;
    const k = Math.max(ZOOM_MIN, Math.min(1, (W - 2 * pad) / b.w, (H - 2 * pad) / b.h));
    const tx = (W - b.w * k) / 2 - b.x0 * k, ty = (H - b.h * k) / 2 - b.y0 * k;
    select(svg).call(z.transform, zoomIdentity.translate(tx, ty).scale(k));
  }, []);

  // Fit each newly loaded diagram once; after that the view is the user's.
  useEffect(() => { fit(); }, [docKey, fit]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current, z = zoomRef.current;
    if (svg && z) select(svg).call(z.scaleBy, factor);
  };

  return (
    <div className="canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="iso"
        role="application"
        aria-label={`${diagram.title}: ${diagram.nodes.length} blocks in 3D. Tab moves between blocks.`}
        onClick={(ev) => { if (!(ev.target as Element).closest('[data-block]')) select_(null); }}
      >
        <g ref={layerRef}>
          <Grid />
          <Scene d={diagram} onBlockPointerDown={onBlockPointerDown} onBlockKeyDown={onBlockKeyDown} />
        </g>
      </svg>
      <div className="zoombar">
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Icon name="minus" /></button>
        <span ref={zoomLabel} className="zoom-val">100%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Icon name="plus" /></button>
        <button type="button" aria-label="Fit to screen" onClick={fit}><Icon name="fit" /></button>
      </div>
    </div>
  );
}
