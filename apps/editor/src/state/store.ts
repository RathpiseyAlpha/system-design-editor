// The editor's state. The diagram store holds the file; components subscribe to the smallest slice they need.
import { create } from 'zustand';
import { fromTemplate, type Diagram } from '@archboard/engine';
import { isPack, type PackId } from '../catalog/packs.ts';

export type Theme = 'light' | 'dark' | 'system';

interface EditorState {
  diagram: Diagram;
  /** Bumped when a different diagram is loaded, so the canvas fits it once. */
  docKey: number;
  pack: PackId;
  selected: string | null;
  theme: Theme;
  load: (d: Diagram) => void;
  setPack: (p: PackId) => void;
  select: (id: string | null) => void;
  setTheme: (t: Theme) => void;
}

const THEME_KEY = 'archboard:theme';
function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

const start = fromTemplate('three-tier');

export const useEditor = create<EditorState>()((set) => ({
  diagram: start,
  docKey: 1,
  pack: isPack(start.show) ? start.show : 'generic',
  selected: null,
  theme: readTheme(),
  load: (d) => set((s) => ({ diagram: d, docKey: s.docKey + 1, selected: null, pack: isPack(d.show) ? d.show : 'generic' })),
  setPack: (pack) => set((s) => ({ pack, diagram: { ...s.diagram, show: pack } })),
  select: (selected) => set({ selected }),
  setTheme: (theme) => {
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private window or blocked storage: the choice lasts for this visit only */
    }
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    set({ theme });
  },
}));
