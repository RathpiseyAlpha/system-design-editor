import { useRef } from 'react';
import { serializeDiagram, TEMPLATES } from '@archboard/engine';
import { useEditor, type Theme } from '../state/store.ts';
import { PACKS, isPack } from '../catalog/packs.ts';
import { Icon } from './Icon.tsx';
import { exportImage } from './exportImage.ts';

/** The brand mark: a tiny compute block. */
function Mark() {
  return (
    <svg className="brand-mark" viewBox="-36 -40 72 80" aria-hidden="true">
      <g className="blk" style={{ ['--c' as string]: 'var(--cat-compute)' }}>
        <polygon className="left" points="-31,-18 0,0 0,36 -31,18" />
        <polygon className="right" points="0,0 31,-18 31,18 0,36" />
        <polygon className="top" points="0,-36 31,-18 0,0 -31,-18" />
        <path className="ol" d="M0 -36 L31 -18 L31 18 L0 36 L-31 18 L-31 -18 Z M-31 -18 L0 0 L31 -18 M0 0 L0 36" />
      </g>
    </svg>
  );
}

const VIEWS: { id: 'canvas' | 'split' | 'code'; name: string; title: string; icon: 'cube' | 'split' | 'code' }[] = [
  { id: 'canvas', name: 'Canvas', title: 'The canvas alone', icon: 'cube' },
  { id: 'split', name: 'Split', title: 'Text and canvas side by side', icon: 'split' },
  { id: 'code', name: 'Code', title: 'The diagram as text', icon: 'code' },
];

const fileName = (title: string) => `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram'}.archboard.json`;

export function TopBar() {
  const title = useEditor((s) => s.diagram.title);
  const save = useEditor((s) => s.save);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const pack = useEditor((s) => s.pack);
  const theme = useEditor((s) => s.theme);
  const layout = useEditor((s) => s.layout);
  const { setPack, setTheme, setTitle, undo, redo, newFromTemplate, openText } = useEditor.getState();
  const fileInput = useRef<HTMLInputElement>(null);

  const download = () => {
    const d = useEditor.getState().diagram;
    const url = URL.createObjectURL(new Blob([serializeDiagram(d)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName(d.title) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Export without the selection's halo and handles: clear it, let the canvas redraw, export, then select again.
  const exportPicture = async (kind: 'png' | 'svg') => {
    const s = useEditor.getState(), was = s.selected;
    const svg = document.querySelector<SVGSVGElement>('svg.iso');
    if (!svg) return;
    s.select(null);
    await new Promise((r) => setTimeout(r, 60));
    try {
      await exportImage(svg, kind, fileName(s.diagram.title).replace(/\.archboard\.json$/, ''));
      s.setNotice({ kind: 'ok', title: `Exported a ${kind.toUpperCase()} picture of ${s.diagram.title}.` });
    } catch (err) {
      s.setNotice({ kind: 'bad', title: 'The picture could not be exported.', lines: [String((err as Error).message ?? err)] });
    } finally {
      s.select(was);
    }
  };

  return (
    <header className="topbar">
      <span className="brand"><Mark />Archboard</span>
      <span className="vsep" />
      <input className="doc-title" aria-label="Diagram name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      {save === 'saved' ? (
        <span className="chip chip--ok" title="Every change is kept in this browser"><Icon name="check" />Saved</span>
      ) : (
        <span className="chip chip--warn" title="This browser blocks storage: use Save to keep your work"><Icon name="alert" />Not saved</span>
      )}
      <span className="spacer" />
      <button className="btn btn--icon btn--ghost" type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Icon name="undo" /></button>
      <button className="btn btn--icon btn--ghost" type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Icon name="redo" /></button>
      <select className="input select file-select" aria-label="New diagram" value="" onChange={(e) => { if (e.target.value) newFromTemplate(e.target.value); }}>
        <option value="">New</option>
        {TEMPLATES.map((t) => <option key={t.id} value={t.id}>New: {t.name}</option>)}
      </select>
      <button className="btn" type="button" onClick={() => fileInput.current?.click()}><Icon name="folder" /><span className="lbl">Open</span></button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) openText(await f.text(), f.name);
        }}
      />
      <button className="btn" type="button" onClick={download}><Icon name="download" /><span className="lbl">Save</span></button>
      <select className="input select file-select" aria-label="Export a picture" value="" onChange={(e) => { const v = e.target.value; if (v === 'png' || v === 'svg') void exportPicture(v); }}>
        <option value="">Export</option>
        <option value="png">Export PNG picture</option>
        <option value="svg">Export SVG picture</option>
      </select>
      <span className="vsep" />
      <div className="seg view-seg" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" aria-pressed={layout === v.id} aria-label={v.name} title={v.title} onClick={() => useEditor.getState().setLayout(v.id)}>
            <Icon name={v.icon} /><span className="lbl">{v.name}</span>
          </button>
        ))}
      </div>
      <div className="seg pack-seg" role="group" aria-label="Show as">
        {PACKS.map((p) => (
          <button key={p.id} type="button" aria-pressed={pack === p.id} onClick={() => setPack(p.id)}>{p.name}</button>
        ))}
      </div>
      <select className="input select pack-select" aria-label="Show as" value={pack} onChange={(e) => isPack(e.target.value) && setPack(e.target.value)}>
        {PACKS.map((p) => <option key={p.id} value={p.id}>Show as: {p.name}</option>)}
      </select>
      <select className="input select theme-select" aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
        <option value="system">Theme: System</option>
        <option value="light">Theme: Light</option>
        <option value="dark">Theme: Dark</option>
      </select>
      <button
        className="btn btn--icon btn--ghost theme-btn"
        type="button"
        aria-label={`Theme: ${theme}. Change theme`}
        title={`Theme: ${theme} (click to change)`}
        onClick={() => setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')}
      >
        <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'contrast'} />
      </button>
    </header>
  );
}
