import { lazy, Suspense, useEffect } from 'react';
import { useEditor } from './state/store.ts';
import { Canvas } from './canvas/Canvas.tsx';
import { Icon, Sprite } from './ui/Icon.tsx';
import { CloudDialogs } from './cloud/CloudUI.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { Palette, findService } from './ui/Palette.tsx';
import { Inspector } from './ui/Inspector.tsx';
import { PresentBar, startPresenting, stopPresenting, stepBy } from './present/PresentBar.tsx';
import { PanelBoundary } from './ui/PanelBoundary.tsx';
import { LearnPanel } from './learn/LearnPanel.tsx';
import { ResultsPanel, RunBar, ScenarioPanel } from './sim/SimPanels.tsx';
import { useSim } from './sim/store.ts';

// The text view loads only when it is opened, so the editor starts without CodeMirror.
// A failed import is not cached by lazy(), so Retry (a new attempt number) makes a new lazy component that loads again.
const panels = new Map<number, { CodePanel: ReturnType<typeof lazy>; NotesPanel: ReturnType<typeof lazy> }>();
function panelsFor(attempt: number) {
  let p = panels.get(attempt);
  if (!p) panels.set(attempt, (p = { CodePanel: lazy(() => import('./code/CodePanel.tsx')), NotesPanel: lazy(() => import('./notes/NotesPanel.tsx')) }));
  return p;
}

function StatusBar() {
  const n = useEditor((s) => s.diagram.nodes.length);
  const e = useEditor((s) => s.diagram.edges.length);
  const z = useEditor((s) => s.diagram.zones.length);
  const sim = useEditor((s) => s.mode === 'simulate');
  return (
    <footer className="statusbar">
      <span className="chip">{n} blocks</span>
      <span className="chip">{e} connections</span>
      <span className="chip">{z} zones</span>
      <span className="spacer" />
      {sim
        ? <span>Press <kbd>Space</kbd> to run or pause; select a block to change its capacity</span>
        : <span>Drag to move, arrows move one cell, <kbd>A</kbd> to add, <kbd>Del</kbd> to delete, <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo</span>}
    </footer>
  );
}

/** A short message over the canvas: what happened, or why a file could not be opened. */
function NoticeBar() {
  const notice = useEditor((s) => s.notice);
  const close = () => useEditor.getState().setNotice(null);
  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const t = setTimeout(close, 4000);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className={`notice notice--${notice.kind}`} role={notice.kind === 'bad' ? 'alert' : 'status'}>
      <Icon name={notice.kind === 'bad' ? 'alert' : 'check'} />
      <div>
        <b>{notice.title}</b>
        {notice.lines && <ul>{notice.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      </div>
      <button className="btn btn--icon btn--ghost" type="button" aria-label="Close message" onClick={close}><Icon name="x" /></button>
    </div>
  );
}

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Shortcuts for the whole editor. Keys typed into a field stay in the field. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      // Present mode takes the keys: step, jump to the ends, or leave. Nothing else can happen while presenting.
      if (s.presenting) {
        const k = e.key;
        if (k === 'Escape') stopPresenting();
        else if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown') stepBy(1);
        else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') stepBy(-1);
        else if (k === 'Home') stepBy(0, 0);
        else if (k === 'End') stepBy(0, Infinity);
        else return;
        e.preventDefault();
        return;
      }
      // The view-only embed: the look can change (Rotate view, Present), the diagram cannot.
      if (s.viewOnly) {
        if (typing(e.target) || mod || e.altKey) return;
        if (e.key.toLowerCase() === 'r') { e.preventDefault(); s.rotate(); }
        else if (e.key.toLowerCase() === 'p') { e.preventDefault(); startPresenting(); }
        return;
      }
      // Simulate mode: Space runs, pauses or plays; nothing on the canvas is edited (capacity settings can be undone).
      if (s.mode === 'simulate') {
        if (mod && e.key.toLowerCase() === 'z' && !typing(e.target)) { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
        if (typing(e.target) || mod || e.altKey) return;
        if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          const sim = useSim.getState();
          if (!sim.result || sim.ran?.diagram !== s.diagram) void sim.run(s.diagram);
          else sim.play(!sim.playing);
        } else if (e.key === 'Escape') s.select(null);
        else if (e.key.toLowerCase() === 'r') { e.preventDefault(); s.rotate(); }
        return;
      }
      if (e.key === 'Escape' && s.connectFrom) { s.setConnectFrom(null); return; }
      if (mod && e.key.toLowerCase() === 'z' && !typing(e.target)) { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing(e.target)) { e.preventDefault(); s.redo(); return; }
      if (typing(e.target) || mod || e.altKey) return;
      if (e.key === 'Escape') { if (s.connectFrom) s.setConnectFrom(null); else s.select(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) { e.preventDefault(); s.remove([s.selected]); }
      else if (e.key.toLowerCase() === 'a') { e.preventDefault(); findService(); }
      else if (e.key.toLowerCase() === 'r') { e.preventDefault(); s.rotate(); }
      else if (e.key.toLowerCase() === 'p') { e.preventDefault(); startPresenting(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useShortcuts();
  const layout = useEditor((s) => s.layout);
  const side = useEditor((s) => s.side);
  const presenting = useEditor((s) => s.presenting);
  const viewOnly = useEditor((s) => s.viewOnly);
  const embedNote = useEditor((s) => s.embedNote);
  const mode = useEditor((s) => s.mode);
  const learning = useEditor((s) => s.learn !== null && s.embedNote === null);
  const canvas = (
    <div className="canvas-wrap">
      <NoticeBar />
      <Canvas />
    </div>
  );
  const code = (
    <PanelBoundary>
      {(attempt) => {
        const { CodePanel, NotesPanel } = panelsFor(attempt);
        return (
          <Suspense fallback={<div className="code-panel code-loading">Opening the text view…</div>}>
            {side === 'notes' ? <NotesPanel /> : <CodePanel />}
          </Suspense>
        );
      }}
    </PanelBoundary>
  );
  if (presenting) {
    return (
      <div className="app app--present">
        <Sprite />
        <div className="canvas-wrap"><Canvas /></div>
        <PresentBar />
      </div>
    );
  }
  if (viewOnly) {
    const view = (
      <div className="canvas-wrap">
        <Canvas />
        {embedNote && <div className="embed-note" role="status"><Icon name="window" /><span>{embedNote}</span></div>}
      </div>
    );
    // Learning mode locked by the host (after a deadline): the brief and the checks stay beside the diagram.
    return (
      <div className="app app--view">
        <Sprite />
        {learning ? <div className="body-learn"><LearnPanel /><div className="learn-main">{view}</div></div> : view}
      </div>
    );
  }
  if (mode === 'simulate') {
    return (
      <div className="app">
        <Sprite />
        <TopBar />
        <CloudDialogs />
        <div className="simgrid">
          <ScenarioPanel />
          <div className="canvas-wrap">
            <NoticeBar />
            <Canvas />
            <RunBar />
          </div>
          <ResultsPanel />
        </div>
        <StatusBar />
      </div>
    );
  }
  const body = (
    <>
      {layout === 'canvas' && (
        <div className="body3">
          <Palette />
          {canvas}
          <Inspector />
        </div>
      )}
      {layout === 'split' && <div className="body-split">{code}{canvas}</div>}
      {layout === 'code' && <div className="body-code">{code}</div>}
    </>
  );
  return (
    <div className="app">
      <Sprite />
      <TopBar />
      <CloudDialogs />
      {learning ? <div className="body-learn"><LearnPanel /><div className="learn-main">{body}</div></div> : body}
      <StatusBar />
    </div>
  );
}
