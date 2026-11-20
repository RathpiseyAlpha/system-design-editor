import { useEffect } from 'react';
import { useEditor } from './state/store.ts';
import { Canvas } from './canvas/Canvas.tsx';
import { Icon, Sprite } from './ui/Icon.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { Palette, findService } from './ui/Palette.tsx';
import { Inspector } from './ui/Inspector.tsx';

function StatusBar() {
  const n = useEditor((s) => s.diagram.nodes.length);
  const e = useEditor((s) => s.diagram.edges.length);
  const z = useEditor((s) => s.diagram.zones.length);
  return (
    <footer className="statusbar">
      <span className="chip">{n} blocks</span>
      <span className="chip">{e} connections</span>
      <span className="chip">{z} zones</span>
      <span className="spacer" />
      <span>Drag to move, arrows move one cell, <kbd>A</kbd> to add, <kbd>Del</kbd> to delete, <kbd>Ctrl</kbd>+<kbd>Z</kbd> to undo</span>
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
      if (mod && e.key.toLowerCase() === 'z' && !typing(e.target)) { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing(e.target)) { e.preventDefault(); s.redo(); return; }
      if (typing(e.target) || mod || e.altKey) return;
      if (e.key === 'Escape') s.select(null);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected) { e.preventDefault(); s.remove([s.selected]); }
      else if (e.key.toLowerCase() === 'a') { e.preventDefault(); findService(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useShortcuts();
  return (
    <div className="app">
      <Sprite />
      <TopBar />
      <div className="body3">
        <Palette />
        <div className="canvas-wrap">
          <NoticeBar />
          <Canvas />
        </div>
        <Inspector />
      </div>
      <StatusBar />
    </div>
  );
}
