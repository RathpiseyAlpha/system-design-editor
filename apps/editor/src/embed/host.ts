// The embed's side of the conversation with its host page (SPEC section 8.1). Messages are accepted only from the parent
// window at the origin the address declares, and sent only to that origin. The host may load a diagram and set the theme;
// the embed answers ready, loaded and error. It never calls the host's server and never reads or writes the autosave.
import { useEditor, EMBED } from '../state/store.ts';
import { EMBED_V, readHostMessage } from './protocol.ts';

export function startEmbedHost() {
  const origin = EMBED.origin;
  if (!EMBED.embed || !origin || EMBED.problem || window.parent === window) return;
  const post = (msg: Record<string, unknown>) => window.parent.postMessage({ ...msg, v: EMBED_V }, origin);
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.origin !== origin || ev.source !== window.parent) return;
    const r = readHostMessage(ev.data);
    if (!r.ok) {
      post({ type: 'error', errors: r.errors });
      return;
    }
    const s = useEditor.getState();
    if (r.msg.type === 'load') {
      s.load(r.msg.diagram);
      if (r.msg.show) s.setPack(r.msg.show);
      // Nothing to undo in a view, and the page no longer waits.
      useEditor.setState({ past: [], future: [], embedNote: null });
      const d = useEditor.getState().diagram;
      post({ type: 'loaded', title: d.title, nodes: d.nodes.length, edges: d.edges.length, zones: d.zones.length });
    } else {
      // The host's theme for this page only: an embed never changes the theme saved for the editor.
      if (r.msg.theme === 'system') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = r.msg.theme;
      useEditor.setState({ theme: r.msg.theme });
    }
  });
  post({ type: 'ready', mode: EMBED.mode });
}
