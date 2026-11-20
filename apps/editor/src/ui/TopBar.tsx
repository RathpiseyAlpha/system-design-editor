import { useEditor, type Theme } from '../state/store.ts';
import { PACKS, isPack } from '../catalog/packs.ts';

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

export function TopBar() {
  const title = useEditor((s) => s.diagram.title);
  const pack = useEditor((s) => s.pack);
  const setPack = useEditor((s) => s.setPack);
  const theme = useEditor((s) => s.theme);
  const setTheme = useEditor((s) => s.setTheme);

  return (
    <header className="topbar">
      <span className="brand"><Mark />Archboard</span>
      <span className="vsep" />
      <span className="doc-title" title={title}>{title}</span>
      <span className="spacer" />
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
    </header>
  );
}
