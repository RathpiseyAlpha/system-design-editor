// The 3D canvas: an SVG scene in painter's order inside one transformed group. d3-zoom pans and zooms that group directly
// (no React render per frame). Pressing a block, a zone's tab, a resize handle or a port never starts a pan.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom';
import type { Diagram, DZone, ZoneKind } from '@archboard/engine';
import { useEditor, type Drag } from '../state/store.ts';
import { moveZone, resizeZone } from '../state/ops.ts';
import { Block, Pill, Wire, ZoneResize, ZoneShape, ZoneTab, zoneTabWidth } from './parts.tsx';
import { projectionOf, clearFlatLabels, bounds, paintOrder, route, snap, f, rot, unrot, rotRect, unrotRect, rotateDiagram, placeLabels, blockBox, tabCandidates, edgeLabelCandidates, pillWidth, type Pt, type Turn } from './geometry.ts';
import { Icon } from '../ui/Icon.tsx';
import { presentSteps } from '../present/steps.ts';
import { startPresenting } from '../present/PresentBar.tsx';
import { runLayout } from '../layout/runLayout.ts';

/** Drag-and-drop type for palette items: a role id, or "zone:<kind>[:<access>]". */
export const ROLE_MIME = 'application/x-archboard-role';
const ZOOM_MIN = 0.25, ZOOM_MAX = 2.5;
const ARROWS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
const NO_PAN = '[data-block], [data-zone-tab], [data-handle]';
/** Present mode and the view-only embed: the canvas can be panned and zoomed, nothing else. */
const readOnly = () => { const s = useEditor.getState(); return s.presenting || s.viewOnly; };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const PRESENT_ZOOM_MAX = 1.6;
/** Room kept free under the diagram for the present bar. */
const PRESENT_BAR = 72;

const Grid = memo(function Grid({ flat }: { flat: boolean }) {
  const { P } = projectionOf(flat);
  const lines: Pt[][] = [];
  for (let k = -30; k <= 60; k++) lines.push([P(k, -30), P(k, 60)], [P(-30, k), P(60, k)]);
  return (
    <g className="grid" aria-hidden="true">
      {lines.map(([a, b], i) => <line key={i} className="gridline" x1={f(a![0])} y1={f(a![1])} x2={f(b![0])} y2={f(b![1])} />)}
    </g>
  );
});

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

/** What the canvas shows while something is dragged: the file with the drag applied. The file itself changes on drop. */
function withDrag(doc: Diagram, drag: Drag | null): Diagram {
  if (!drag) return doc;
  if (drag.kind === 'node') return { ...doc, nodes: doc.nodes.map((n) => (n.id === drag.id ? { ...n, x: drag.x, y: drag.y } : n)) };
  if (drag.kind === 'zone') return moveZone(doc, drag.id, drag.dx, drag.dy);
  return resizeZone(doc, drag.id, drag.w, drag.h, drag.x, drag.y);
}

interface Handlers {
  onBlockPointerDown: (e: PointerEvent<SVGGElement>, id: string) => void;
  onBlockKeyDown: (e: KeyboardEvent<SVGGElement>, id: string) => void;
  onZonePointerDown: (e: PointerEvent<SVGGElement>, id: string) => void;
  onResizePointerDown: (e: PointerEvent<SVGGElement>, id: string) => void;
}

const Scene = memo(function Scene({ d: doc, h }: { d: Diagram; h: Handlers }) {
  const pack = useEditor((s) => s.pack);
  const selected = useEditor((s) => s.selected);
  const drag = useEditor((s) => s.drag);
  const turn = useEditor((s) => s.turn);
  const flat = useEditor((s) => s.flat);
  const proj = projectionOf(flat);
  // The scene draws the file as the turned view sees it (Rotate view); handlers turn edits back into file coordinates.
  const d = useMemo(() => rotateDiagram(withDrag(doc, drag), turn), [doc, drag, turn]);
  const byId = useMemo(() => new Map(d.nodes.map((n) => [n.id, n])), [d.nodes]);
  const wires = useMemo(
    () =>
      d.edges.flatMap((e) => {
        const a = byId.get(e.from), b = byId.get(e.to);
        if (!a || !b) return [];
        const screen = route(a, b, d.nodes).map(([gx, gy]): Pt => { const [x, y] = proj.P(gx, gy); return [x, y - proj.lift]; });
        return [{ e, screen: proj.flat ? clearFlatLabels(screen) : screen }];
      }),
    [d.edges, d.nodes, byId, proj],
  );
  const zones = useMemo(() => zoneDepthOrder(d.zones), [d.zones]);
  const nodes = useMemo(() => [...d.nodes].sort(paintOrder), [d.nodes]);
  // Zone tabs first, then connection labels: each takes the first candidate place that covers no block and no other label.
  const labelAt = useMemo(
    () =>
      placeLabels(
        [
          ...zones.map((z) => { const width = zoneTabWidth(z, pack); return { id: z.id, width, at: tabCandidates(z, proj, width) }; }),
          ...wires.filter((w) => w.e.label).map((w) => ({ id: w.e.id, width: pillWidth(w.e.label!), at: edgeLabelCandidates(w.screen) })),
        ],
        d.nodes.map((n) => blockBox(n, proj)),
      ),
    [zones, wires, d.nodes, pack, proj],
  );
  const selZone = d.zones.find((z) => z.id === selected);

  return (
    <>
      {zones.map((z) => <ZoneShape key={z.id} z={z} selected={z.id === selected} flat={flat} />)}
      {wires.map(({ e, screen }) => <Wire key={e.id} id={e.id} points={screen} kind={e.kind} selected={e.id === selected} />)}
      {nodes.map((n) => (
        <Block key={n.id} node={n} pack={pack} selected={selected === n.id} flat={flat} onPointerDown={h.onBlockPointerDown} onKeyDown={h.onBlockKeyDown} />
      ))}
      {zones.map((z) => <ZoneTab key={z.id} z={z} pack={pack} at={labelAt.get(z.id)!} onPointerDown={h.onZonePointerDown} />)}
      {wires.filter((w) => w.e.label).map(({ e }) => { const at = labelAt.get(e.id)!; return <Pill key={e.id} x={at[0]} y={at[1]} text={e.label!} />; })}
      {selZone && <ZoneResize z={selZone} flat={flat} onPointerDown={h.onResizePointerDown} />}
    </>
  );
});

/**
 * Follow the pointer until it is released. `at` turns the ground offset of the pointer (not snapped) into the snapped
 * target, so a position lands on the half-cell grid wherever it started; `move` gets each new target, `done` the last.
 */
function trackPointer(
  e: PointerEvent,
  k: number,
  at: (dgx: number, dgy: number) => [number, number],
  move: (t: [number, number]) => void,
  done: (t: [number, number]) => void,
) {
  const x0 = e.clientX, y0 = e.clientY;
  const { toGround } = projectionOf(useEditor.getState().flat);
  let last = at(0, 0);
  const start = last;
  const onMove = (ev: globalThis.PointerEvent) => {
    const next = at(...toGround((ev.clientX - x0) / k, (ev.clientY - y0) / k));
    if (next[0] !== last[0] || next[1] !== last[1]) { last = next; move(next); }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (last[0] !== start[0] || last[1] !== start[1]) done(last);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

export function Canvas() {
  const diagram = useEditor((s) => s.diagram);
  const docKey = useEditor((s) => s.docKey);
  const connectFrom = useEditor((s) => s.connectFrom);
  const flat = useEditor((s) => s.flat);
  const presenting = useEditor((s) => s.presenting);
  const step = useEditor((s) => s.step);
  const viewOnly = useEditor((s) => s.viewOnly);
  const anim = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const layerRef = useRef<SVGGElement>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const diagramRef = useRef(diagram);
  diagramRef.current = diagram;
  /** A connection being drawn from a port: from its block to the pointer, in layer coordinates. */
  const [rubber, setRubber] = useState<{ from: string; a: Pt; b: Pt } | null>(null);
  const [laying, setLaying] = useState(false);
  const layOut = async () => {
    const s = useEditor.getState();
    if (laying || !s.diagram.nodes.length) return;
    setLaying(true);
    try {
      s.applyLayout(await runLayout(s.diagram));
      s.setNotice({ kind: 'ok', title: 'Laid out. Undo puts everything back where it was.' });
    } catch (err) {
      s.setNotice({ kind: 'bad', title: 'The layout could not be made.', lines: [String((err as Error).message ?? err)] });
    } finally {
      setLaying(false);
    }
  };

  useEffect(() => {
    const svg = svgRef.current!;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .filter((ev: Event) => {
        if (ev.type === 'wheel') return true;
        const target = ev.target as Element | null;
        return !(ev as globalThis.MouseEvent).button && (readOnly() || !target?.closest(NO_PAN));
      })
      .on('zoom', (ev) => {
        layerRef.current?.setAttribute('transform', ev.transform.toString());
        if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(ev.transform.k * 100)}%`;
      });
    select(svg).call(z).on('dblclick.zoom', null);
    zoomRef.current = z;
    // Tell the store where the middle of the visible canvas is, for things added from the palette.
    useEditor.setState({
      viewCenter: () => {
        const [sx, sy] = zoomTransform(svg).invert([svg.clientWidth / 2, svg.clientHeight / 2]);
        const [gx, gy] = projectionOf(useEditor.getState().flat).toGround(sx, sy);
        return unrot(snap(gx), snap(gy), useEditor.getState().turn);
      },
    });
    return () => { select(svg).on('.zoom', null); };
  }, []);

  /** Layer coordinates (before zoom) of a point of the window. */
  const layerAt = (clientX: number, clientY: number): Pt => {
    const svg = svgRef.current!, rect = svg.getBoundingClientRect();
    return zoomTransform(svg).invert([clientX - rect.left, clientY - rect.top]) as Pt;
  };
  const groundAt = (clientX: number, clientY: number): [number, number] => {
    const [gx, gy] = projectionOf(useEditor.getState().flat).toGround(...layerAt(clientX, clientY));
    return unrot(snap(gx), snap(gy), useEditor.getState().turn);
  };
  const k = () => zoomTransform(svgRef.current!).k;

  /** Draw a connection from a block's port: a line follows the pointer; releasing over another block connects them. */
  const startConnect = (e: PointerEvent, from: string) => {
    const a = layerAt(e.clientX, e.clientY);
    setRubber({ from, a, b: a });
    const onMove = (ev: globalThis.PointerEvent) => setRubber({ from, a, b: layerAt(ev.clientX, ev.clientY) });
    const onUp = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setRubber(null);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-block]')?.getAttribute('data-block');
      if (target && target !== from) useEditor.getState().connect(from, target);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handlers = useMemo<Handlers>(
    () => ({
      // Press a block: in "Connect to" mode, connect; on a port, draw a connection; otherwise select and drag it
      // (snapped to half cells, drawn at the drag position, committed once on drop as one undo step).
      onBlockPointerDown: (e, id) => {
        if (e.button !== 0 || readOnly()) return;
        e.preventDefault();
        const st = useEditor.getState();
        if (st.connectFrom && st.connectFrom !== id) { st.connect(st.connectFrom, id); return; }
        if ((e.target as Element).closest('[data-port]')) { startConnect(e, id); return; }
        st.select(id);
        const node = st.diagram.nodes.find((n) => n.id === id);
        if (!node) return;
        const t = st.turn, [vx, vy] = rot(node.x, node.y, t);
        trackPointer(
          e,
          k(),
          (dx, dy) => (dx === 0 && dy === 0 ? [node.x, node.y] : unrot(snap(vx + dx), snap(vy + dy), t)),
          ([x, y]) => useEditor.getState().setDrag({ kind: 'node', id, x, y }),
          ([x, y]) => {
            const s = useEditor.getState();
            s.setDrag(null);
            s.move(id, x, y);
          },
        );
      },
      // Keyboard on a focused block: Enter or Space selects (or connects, in "Connect to" mode), arrows move one cell
      // along the grid, Delete removes it.
      onBlockKeyDown: (e, id) => {
        if (readOnly()) return;
        const s = useEditor.getState();
        const arrow = ARROWS[e.key];
        const step = arrow ? unrot(arrow[0], arrow[1], s.turn) : undefined;
        if (e.key === 'Enter' || e.key === ' ') {
          if (s.connectFrom && s.connectFrom !== id) s.connect(s.connectFrom, id);
          else s.select(id);
        } else if (step) {
          const n = s.diagram.nodes.find((x) => x.id === id);
          if (n) { s.select(id); s.move(id, n.x + step[0], n.y + step[1]); }
        } else if (e.key === 'Delete' || e.key === 'Backspace') s.remove([id]);
        else return;
        e.preventDefault();
        e.stopPropagation();
      },
      // Drag a zone's tab: the zone moves with everything inside it.
      onZonePointerDown: (e, id) => {
        if (e.button !== 0 || readOnly()) return;
        e.preventDefault();
        useEditor.getState().select(id);
        const z = useEditor.getState().diagram.zones.find((x) => x.id === id);
        if (!z) return;
        const t = useEditor.getState().turn, v = rotRect(z, t);
        // The zone's corner lands on the grid (as seen); what is inside moves by the same amount and keeps its arrangement.
        trackPointer(
          e,
          k(),
          (dx, dy) => (dx === 0 && dy === 0 ? [0, 0] : unrot(snap(v.x + dx) - v.x, snap(v.y + dy) - v.y, t)),
          ([dx, dy]) => useEditor.getState().setDrag({ kind: 'zone', id, dx, dy }),
          ([dx, dy]) => {
            const s = useEditor.getState();
            s.setDrag(null);
            s.moveZone(id, dx, dy);
          },
        );
      },
      // Drag a selected zone's corner handle to resize it.
      onResizePointerDown: (e, id) => {
        if (e.button !== 0 || readOnly()) return;
        e.preventDefault();
        const z = useEditor.getState().diagram.zones.find((x) => x.id === id);
        if (!z) return;
        const t = useEditor.getState().turn, v = rotRect(z, t);
        // The far corner (as seen) lands on the grid; the new rectangle is turned back into the file.
        const fileRect = (w: number, h: number) => unrotRect({ x: v.x, y: v.y, w, h }, t);
        trackPointer(
          e,
          k(),
          (dx, dy) => (dx === 0 && dy === 0 ? [v.w, v.h] : [Math.max(2, snap(v.x + v.w + dx) - v.x), Math.max(2, snap(v.y + v.h + dy) - v.y)]),
          ([w, h]) => useEditor.getState().setDrag({ kind: 'resize', id, ...fileRect(w, h) }),
          ([w, h]) => {
            const s = useEditor.getState();
            s.setDrag(null);
            const r = fileRect(w, h);
            s.resizeZone(id, r.w, r.h, r.x, r.y);
          },
        );
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Fit a part of the diagram (all of it by default) into the canvas; glide there when asked, unless motion is reduced. */
  const fit = useCallback((part?: Diagram, glide = false, most = 1, below = 0) => {
    const svg = svgRef.current, z = zoomRef.current;
    if (!svg || !z) return;
    const st = useEditor.getState();
    const b = bounds(rotateDiagram(part ?? diagramRef.current, st.turn as Turn), projectionOf(st.flat)), W = svg.clientWidth, H = svg.clientHeight, pad = 48;
    const s = Math.max(ZOOM_MIN, Math.min(most, (W - 2 * pad) / b.w, (H - below - 2 * pad) / b.h));
    const to = zoomIdentity.translate((W - b.w * s) / 2 - b.x0 * s, (H - below - b.h * s) / 2 - b.y0 * s).scale(s);
    cancelAnimationFrame(anim.current);
    if (!glide || reducedMotion()) { select(svg).call(z.transform, to); return; }
    const from = zoomTransform(svg), t0 = performance.now(), D = 420;
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / D), e = 1 - (1 - u) ** 3;
      const k = from.k + (to.k - from.k) * e;
      select(svg).call(z.transform, zoomIdentity.translate(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e).scale(k));
      if (u < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  }, []);
  // Fit each newly loaded diagram once; after that the view is the user's.
  useEffect(() => { fit(); }, [docKey, fit]);
  // Present mode: show the step's part, closer than 100% when a zone is small.
  useEffect(() => {
    if (!presenting) return;
    const steps = presentSteps(diagramRef.current);
    const part = steps[Math.min(step, steps.length - 1)]!.part;
    const r = requestAnimationFrame(() => fit(part, true, PRESENT_ZOOM_MAX, PRESENT_BAR));
    return () => cancelAnimationFrame(r);
  }, [presenting, step, fit]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current, z = zoomRef.current;
    if (svg && z) select(svg).call(z.scaleBy, factor);
  };

  // A click (not a pan) picks what is under it: a connection, a zone, or nothing.
  const onClick = (ev: MouseEvent) => {
    if (readOnly()) return;
    const t = ev.target as Element;
    if (t.closest('[data-block], [data-zone-tab], [data-handle]')) return;
    const s = useEditor.getState();
    if (s.connectFrom) { s.setConnectFrom(null); return; }
    const edge = t.closest('[data-edge]')?.getAttribute('data-edge');
    const zone = t.closest('[data-zone]')?.getAttribute('data-zone');
    s.select(edge ?? zone ?? null);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (readOnly()) return;
    if (e.dataTransfer.types.includes(ROLE_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const item = e.dataTransfer.getData(ROLE_MIME);
    if (!item || readOnly()) return;
    e.preventDefault();
    const at = groundAt(e.clientX, e.clientY);
    const s = useEditor.getState();
    if (item.startsWith('zone:')) {
      const [, kind, access] = item.split(':');
      s.addZone(kind as ZoneKind, access as 'public' | 'private' | undefined, at);
    } else s.add(item, at);
  };

  const fromLabel = connectFrom ? diagram.nodes.find((n) => n.id === connectFrom)?.label : null;

  return (
    <div className={`canvas${connectFrom ? ' connecting' : ''}`} onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="iso"
        role="application"
        aria-label={`${diagram.title}: ${diagram.nodes.length} blocks${flat ? ', seen from above' : ' in 3D'}. Tab moves between blocks.`}
        onClick={onClick}
      >
        <g ref={layerRef}>
          <Grid flat={flat} />
          <g className="scene"><Scene d={diagram} h={handlers} /></g>
          {rubber && <line className="rubber" x1={f(rubber.a[0])} y1={f(rubber.a[1])} x2={f(rubber.b[0])} y2={f(rubber.b[1])} markerEnd="url(#head)" />}
        </g>
      </svg>
      {fromLabel && (
        <div className="hintbar" role="status">
          <Icon name="arrow" />
          <span>Pick the block to connect <b>{fromLabel}</b> to. Esc cancels.</span>
        </div>
      )}
      {!presenting && !viewOnly && <div className="canvas-tools">
        <div className="seg proj-seg" role="group" aria-label="Look">
          <button type="button" aria-pressed={!flat} aria-label="3D view" title="Blocks in 3D" onClick={() => useEditor.getState().setFlat(false)}><Icon name="cube" /><span className="lbl">3D</span></button>
          <button type="button" aria-pressed={flat} aria-label="Flat view" title="Seen from above, like a plan" onClick={() => useEditor.getState().setFlat(true)}><Icon name="flat" /><span className="lbl">Flat</span></button>
        </div>
        <button className="btn btn--sm" type="button" title="Arrange the whole diagram left to right" aria-label="Auto-layout" disabled={laying} onClick={layOut}>
          <Icon name="layout" /><span className="lbl">{laying ? 'Laying out…' : 'Auto-layout'}</span>
        </button>
        <button className="btn btn--sm" type="button" title="Rotate view (R)" aria-label="Rotate view" onClick={() => useEditor.getState().rotate()}><Icon name="rotate" /><span className="lbl">Rotate view</span></button>
        <button className="btn btn--sm" type="button" title="Present: the whole diagram, then each zone (P)" aria-label="Present" onClick={() => startPresenting()}><Icon name="play" /><span className="lbl">Present</span></button>
      </div>}
      {!presenting && <div className="zoombar">
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Icon name="minus" /></button>
        <span ref={zoomLabel} className="zoom-val">100%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Icon name="plus" /></button>
        <button type="button" aria-label="Fit to screen" onClick={() => fit()}><Icon name="fit" /></button>
      </div>}
    </div>
  );
}
