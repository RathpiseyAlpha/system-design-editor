// The editor's state. The diagram store holds the file and its history; components subscribe to the smallest slice they need.
import { create } from 'zustand';
import { fromTemplate, parseDiagramText, serializeDiagram, type Diagram, type DNode } from '@archboard/engine';
import { isPack, type PackId } from '../catalog/packs.ts';
import { addNode, deleteNodes, moveNode, updateNode } from './ops.ts';

export type Theme = 'light' | 'dark' | 'system';
export type SaveState = 'saved' | 'blocked';
export interface Notice { kind: 'bad' | 'ok'; title: string; lines?: string[] }

const HISTORY = 100;
const COALESCE_MS = 1500;
const AUTOSAVE_KEY = 'archboard:autosave';
const THEME_KEY = 'archboard:theme';

interface EditorState {
  diagram: Diagram;
  past: Diagram[];
  future: Diagram[];
  /** Key and time of the last edit, so typing in one field becomes one undo step. */
  lastEdit: { key: string; at: number } | null;
  /** Bumped when a different diagram is loaded, so the canvas fits it once. */
  docKey: number;
  pack: PackId;
  selected: string | null;
  /** A block being dragged: drawn at this position until the drop is committed. Not part of the history. */
  drag: { id: string; x: number; y: number } | null;
  theme: Theme;
  save: SaveState;
  notice: Notice | null;
  /** Ground cell at the centre of the visible canvas; set by the canvas. */
  viewCenter: () => [number, number];

  commit: (next: Diagram, key?: string) => void;
  undo: () => void;
  redo: () => void;
  load: (d: Diagram) => void;
  openText: (text: string, fileName: string) => void;
  newFromTemplate: (id: string) => void;
  setPack: (p: PackId) => void;
  select: (id: string | null) => void;
  setTheme: (t: Theme) => void;
  setNotice: (n: Notice | null) => void;
  setDrag: (d: EditorState['drag']) => void;

  add: (role: string, at?: [number, number]) => void;
  move: (id: string, x: number, y: number) => void;
  update: (id: string, patch: Partial<Omit<DNode, 'id'>>, key?: string) => void;
  remove: (ids: string[]) => void;
  setTitle: (title: string) => void;
}

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

/** The diagram saved in this browser, if there is one and it is still valid; otherwise the 3-tier template. */
function startDiagram(): Diagram {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (text) {
      const r = parseDiagramText(text);
      if (r.ok) return r.diagram;
    }
  } catch {
    /* storage blocked: start from the template */
  }
  return fromTemplate('three-tier');
}

const start = startDiagram();

export const useEditor = create<EditorState>()((set, get) => ({
  diagram: start,
  past: [],
  future: [],
  lastEdit: null,
  docKey: 1,
  pack: isPack(start.show) ? start.show : 'generic',
  selected: null,
  drag: null,
  theme: readTheme(),
  save: 'saved',
  notice: null,
  viewCenter: () => [8, 5],

  commit: (next, key) =>
    set((s) => {
      const now = Date.now();
      const merge = key !== undefined && s.lastEdit?.key === key && now - s.lastEdit.at < COALESCE_MS;
      return {
        diagram: next,
        past: merge ? s.past : [...s.past, s.diagram].slice(-HISTORY),
        future: [],
        lastEdit: key !== undefined ? { key, at: now } : null,
      };
    }),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return {};
      return { diagram: prev, past: s.past.slice(0, -1), future: [s.diagram, ...s.future], lastEdit: null, selected: keep(prev, s.selected) };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return { diagram: next, past: [...s.past, s.diagram], future: s.future.slice(1), lastEdit: null, selected: keep(next, s.selected) };
    }),
  // Loading keeps the previous diagram in the history, so New and Open never lose work: Undo brings it back.
  load: (d) => set((s) => ({ diagram: d, past: [...s.past, s.diagram].slice(-HISTORY), future: [], lastEdit: null, docKey: s.docKey + 1, selected: null, drag: null, pack: isPack(d.show) ? d.show : 'generic' })),
  openText: (text, fileName) => {
    const r = parseDiagramText(text);
    if (r.ok) {
      get().load(r.diagram);
      set({ notice: { kind: 'ok', title: `Opened ${fileName}.` } });
    } else {
      set({ notice: { kind: 'bad', title: `${fileName} could not be opened.`, lines: r.errors.slice(0, 6) } });
    }
  },
  newFromTemplate: (id) => {
    get().load(fromTemplate(id));
    set({ notice: { kind: 'ok', title: 'Started a new diagram. Undo brings back the previous one.' } });
  },
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
  setNotice: (notice) => set({ notice }),
  setDrag: (drag) => set({ drag }),

  add: (role, at) => {
    const [x, y] = at ?? get().viewCenter();
    const { diagram, id } = addNode(get().diagram, role, x, y);
    get().commit(diagram);
    set({ selected: id });
  },
  move: (id, x, y) => get().commit(moveNode(get().diagram, id, x, y)),
  update: (id, patch, key) => get().commit(updateNode(get().diagram, id, patch), key),
  remove: (ids) => {
    if (!ids.length) return;
    get().commit(deleteNodes(get().diagram, ids));
    set({ selected: null });
  },
  setTitle: (title) => get().commit({ ...get().diagram, title }, 'title'),
}));

function keep(d: Diagram, id: string | null): string | null {
  return id && d.nodes.some((n) => n.id === id) ? id : null;
}

// Autosave in this browser, half a second after the last change. Storage can be blocked: then the status says so.
let timer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.diagram === prev.diagram) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeDiagram(useEditor.getState().diagram));
      if (useEditor.getState().save !== 'saved') useEditor.setState({ save: 'saved' });
    } catch {
      useEditor.setState({ save: 'blocked' });
    }
  }, 500);
});
