// The editor's state. The diagram store holds the file and its history; components subscribe to the smallest slice they need.
import { create } from 'zustand';
import { emptyDiagram, evaluateRules, fromTemplate, parseDiagramText, serializeDiagram, type CheckResult, type Diagram, type DEdge, type DNode, type DZone, type Ruleset, type ZoneKind } from '@archboard/engine';
import { isPack, type PackId } from '../catalog/packs.ts';
import { readEmbed, type Brief } from '../embed/protocol.ts';
import { addEdge, addNode, addZone, deleteEdge, deleteNodes, deleteZone, moveNode, moveZone, resizeZone, updateEdge, updateNode, updateZone } from './ops.ts';

export type Theme = 'light' | 'dark' | 'system';
export type SaveState = 'saved' | 'blocked';
export interface Notice { kind: 'bad' | 'ok'; title: string; lines?: string[] }

const HISTORY = 100;
const COALESCE_MS = 1500;
const AUTOSAVE_KEY = 'archboard:autosave';
const THEME_KEY = 'archboard:theme';

/** Opened as an embed (/embed/?mode=…&origin=…)? Then the page shows what the host sends and never touches the autosave. */
export const EMBED = typeof location === 'undefined' ? readEmbed('/', '') : readEmbed(location.pathname, location.search);

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
  /** Something being dragged, drawn at its new place until the drop is committed. Not part of the history. */
  drag: Drag | null;
  /** "Connect to": the block a new connection starts from, waiting for the user to pick the other end. */
  connectFrom: string | null;
  /** Quarter turns of the view (Rotate view). The file never changes when the view turns. */
  turn: 0 | 1 | 2 | 3;
  /** How the canvas looks at the ground: the 3D isometric view, or flat from above. View only, like turn. */
  flat: boolean;
  /** What the main area shows: the canvas, the canvas beside the text (Split), or the text alone (Code). */
  layout: 'canvas' | 'split' | 'code';
  /** Which document the side panel shows in Split and Code: the diagram as text, or its Markdown notes. */
  side: 'text' | 'notes';
  /** Design (draw and edit) or Simulate (run scenarios on the diagram as it is; nothing moves, capacity settings change). */
  mode: 'design' | 'simulate';
  /** Present mode: only the canvas, nothing can be changed, the arrow keys step from the whole diagram to each zone. */
  presenting: boolean;
  /** The present step being shown (0 is the whole diagram). */
  step: number;
  /** The read-only embed (?mode=view): the same canvas with every edit off. Set once at start. */
  viewOnly: boolean;
  /** In an embed: what the page is waiting for, or why it cannot start. */
  embedNote: string | null;
  /** Learning mode (an embed with mode=learn): the host's brief and rules, and the last Check. */
  learn: Learn | null;
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
  setDrag: (d: Drag | null) => void;
  setConnectFrom: (id: string | null) => void;
  rotate: () => void;
  setFlat: (flat: boolean) => void;
  setLayout: (l: 'canvas' | 'split' | 'code') => void;
  setSide: (side: 'text' | 'notes') => void;
  present: (on: boolean) => void;
  setMode: (m: 'design' | 'simulate') => void;
  setStep: (step: number) => void;
  /** Replace the diagram's notes; typing is one undo step. */
  setNotes: (text: string) => void;
  /** Learning mode: check the diagram against the host's rules, here in the browser (indicative; the host scores). */
  check: () => void;
  /** Replace positions with an auto-layout: one undo step, and the view fits the result. */
  applyLayout: (d: Diagram) => void;

  add: (role: string, at?: [number, number]) => void;
  move: (id: string, x: number, y: number) => void;
  update: (id: string, patch: Partial<Omit<DNode, 'id'>>, key?: string) => void;
  /** Delete blocks, zones or connections by id (a block takes its connections with it). */
  remove: (ids: string[]) => void;
  setTitle: (title: string) => void;

  addZone: (kind: ZoneKind, access?: 'public' | 'private', at?: [number, number]) => void;
  moveZone: (id: string, dx: number, dy: number) => void;
  resizeZone: (id: string, w: number, h: number, x?: number, y?: number) => void;
  updateZone: (id: string, patch: Partial<Pick<DZone, 'label' | 'kind' | 'access'>>, key?: string) => void;
  connect: (from: string, to: string) => void;
  updateEdge: (id: string, patch: Partial<Pick<DEdge, 'kind' | 'label'>>, key?: string) => void;
}

export interface Learn {
  brief: Brief | null;
  rules: Ruleset | null;
  /** The last Check, kept until the next one; `checked` is the diagram it looked at (an edit since makes it out of date). */
  result: CheckResult | null;
  checkedAt: number | null;
  checked: Diagram | null;
}

export type Drag =
  | { kind: 'node'; id: string; x: number; y: number }
  | { kind: 'zone'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string; x: number; y: number; w: number; h: number };

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
  if (EMBED.embed) return emptyDiagram('Waiting for the diagram');
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
  connectFrom: null,
  turn: 0,
  flat: false,
  layout: 'canvas',
  side: 'text',
  mode: 'design',
  presenting: false,
  step: 0,
  viewOnly: EMBED.embed,
  embedNote: EMBED.embed ? EMBED.problem ?? 'Waiting for the host page to send a diagram.' : null,
  learn: EMBED.mode === 'learn' && !EMBED.problem ? { brief: null, rules: null, result: null, checkedAt: null, checked: null } : null,
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
  load: (d) => set((s) => ({ diagram: d, past: [...s.past, s.diagram].slice(-HISTORY), future: [], lastEdit: null, docKey: s.docKey + 1, selected: null, drag: null, connectFrom: null, pack: isPack(d.show) ? d.show : 'generic' })),
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
  setConnectFrom: (connectFrom) => set({ connectFrom }),
  rotate: () => set((s) => ({ turn: ((s.turn + 1) % 4) as 0 | 1 | 2 | 3, docKey: s.docKey + 1 })),
  setFlat: (flat) => set((s) => (s.flat === flat ? {} : { flat, drag: null, docKey: s.docKey + 1 })),
  setLayout: (layout) => set({ layout, connectFrom: null }),
  setSide: (side) => set({ side }),
  present: (on) => set({ presenting: on, step: 0, selected: null, connectFrom: null, drag: null }),
  setStep: (step) => set({ step }),
  setMode: (mode) => set({ mode, layout: 'canvas', connectFrom: null, drag: null }),
  check: () => {
    const s = get();
    if (!s.learn?.rules) return;
    set({ learn: { ...s.learn, result: evaluateRules(s.diagram, s.learn.rules), checkedAt: Date.now(), checked: s.diagram } });
  },
  setNotes: (text) => {
    const { notes: _old, ...rest } = get().diagram;
    get().commit(text ? { ...rest, notes: text } : rest, 'docnotes');
  },
  applyLayout: (d) => {
    get().commit(d);
    set((s) => ({ docKey: s.docKey + 1 }));
  },

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
    let d = get().diagram;
    const nodes = ids.filter((id) => d.nodes.some((n) => n.id === id));
    if (nodes.length) d = deleteNodes(d, nodes);
    for (const id of ids) {
      if (d.zones.some((z) => z.id === id)) d = deleteZone(d, id);
      else if (d.edges.some((e) => e.id === id)) d = deleteEdge(d, id);
    }
    get().commit(d);
    set({ selected: null });
  },
  setTitle: (title) => get().commit({ ...get().diagram, title }, 'title'),

  addZone: (kind, access, at) => {
    const [x, y] = at ?? get().viewCenter();
    const { diagram, id } = addZone(get().diagram, kind, x, y, access);
    get().commit(diagram);
    set({ selected: id });
  },
  moveZone: (id, dx, dy) => get().commit(moveZone(get().diagram, id, dx, dy)),
  resizeZone: (id, w, h, x, y) => get().commit(resizeZone(get().diagram, id, w, h, x, y)),
  updateZone: (id, patch, key) => get().commit(updateZone(get().diagram, id, patch), key),
  connect: (from, to) => {
    const { diagram, id } = addEdge(get().diagram, from, to);
    if (id === null) return;
    if (diagram !== get().diagram) get().commit(diagram);
    set({ selected: id, connectFrom: null });
  },
  updateEdge: (id, patch, key) => get().commit(updateEdge(get().diagram, id, patch), key),
}));

function keep(d: Diagram, id: string | null): string | null {
  return id && [...d.nodes, ...d.zones, ...d.edges].some((x) => x.id === id) ? id : null;
}

// Autosave in this browser, half a second after the last change. Storage can be blocked: then the status says so.
let timer: ReturnType<typeof setTimeout> | undefined;
useEditor.subscribe((s, prev) => {
  if (s.diagram === prev.diagram || EMBED.embed) return;
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
