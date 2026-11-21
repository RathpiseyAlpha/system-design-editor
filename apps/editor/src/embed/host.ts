// The embed's side of the conversation with its host page (SPEC section 8.1). Messages are accepted only from the parent
// window at the origin the address declares, and sent only to that origin. The embed never calls the host's server and never
// reads or writes the autosave: in edit and learn modes the host keeps the student's work, from `change` and `save`.
//
//   host -> editor: hello, load {diagram, show?, readOnly?, brief?, rules?}, setTheme {theme}, requestSave
//   editor -> host: ready {mode}, loaded {title, nodes, edges, zones}, error {errors}, change {diagram, dirty},
//                   save {diagram}, hints {results, score, max, indicative}
import { serializeDiagram, type Diagram } from '@archboard/engine';
import { useEditor, EMBED } from '../state/store.ts';
import { EMBED_V, readHostMessage } from './protocol.ts';

/** Changes are sent this long after the last edit, so a drag or typing is one message. */
export const CHANGE_MS = 800;

export function startEmbedHost() {
  const origin = EMBED.origin;
  if (!EMBED.embed || !origin || EMBED.problem || window.parent === window) return;
  const post = (msg: Record<string, unknown>) => window.parent.postMessage({ ...msg, v: EMBED_V }, origin);
  const plain = (d: Diagram) => JSON.parse(serializeDiagram(d)) as unknown;
  const editable = EMBED.mode === 'edit' || EMBED.mode === 'learn';

  // What the host has: `sent` is the diagram it loaded or last received (change or save); `saved` the one it loaded or
  // asked to save. A change is "dirty" until the host saves it. `loading` keeps the host's own load from echoing back.
  let sent: Diagram | null = null, saved: Diagram | null = null, loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.origin !== origin || ev.source !== window.parent) return;
    const r = readHostMessage(ev.data);
    if (!r.ok) {
      post({ type: 'error', errors: r.errors });
      return;
    }
    const msg = r.msg;
    const s = useEditor.getState();
    if (msg.type === 'hello') {
      // A host that started listening after the first ready asks again.
      post({ type: 'ready', mode: EMBED.mode });
    } else if (msg.type === 'load') {
      clearTimeout(timer);
      loading = true;
      s.load(msg.diagram);
      if (msg.show) s.setPack(msg.show);
      loading = false;
      const d = useEditor.getState().diagram;
      sent = saved = d;
      useEditor.setState({
        past: [], future: [], embedNote: null,
        // A view, or a host that locks the work (after a deadline), is read-only; edit and learn are not.
        viewOnly: !editable || msg.readOnly,
        ...(EMBED.mode === 'learn' ? { learn: { brief: msg.brief, rules: msg.rules, result: null, checkedAt: null, checked: null } } : {}),
      });
      post({ type: 'loaded', title: d.title, nodes: d.nodes.length, edges: d.edges.length, zones: d.zones.length });
    } else if (msg.type === 'requestSave') {
      clearTimeout(timer);
      sent = saved = s.diagram;
      post({ type: 'save', diagram: plain(s.diagram) });
    } else {
      // The host's theme for this page only: an embed never changes the theme saved for the editor.
      if (msg.theme === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = msg.theme;
      useEditor.setState({ theme: msg.theme });
    }
  });

  useEditor.subscribe((s, prev) => {
    // Every edit, a moment after the last one: the host keeps it (the embed has no autosave of its own).
    if (editable && sent && !loading && s.diagram !== prev.diagram) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const d = useEditor.getState().diagram;
        if (d === sent) return;
        sent = d;
        post({ type: 'change', diagram: plain(d), dirty: d !== saved });
      }, CHANGE_MS);
    }
    // Each Check in learning mode: the results, marked indicative (the host scores on its server, with its own rules).
    const r = s.learn?.result;
    if (r && r !== prev.learn?.result) post({ type: 'hints', results: r.results, score: r.score, max: r.max, indicative: true });
  });

  post({ type: 'ready', mode: EMBED.mode });
}
