// Diagram as code: a text view of the same diagram, kept in sync both ways (SPEC section 4, v1.5; decisions 25 to 28).
// Typing is applied about 0.4 s after the last key, as one undo step, and only when the text is valid; while it is not,
// the canvas keeps the last good diagram and the error is shown on its line. Changes made on the canvas reprint the text,
// unless the text holds typing not yet applied (or invalid), which is never overwritten.
import { useEffect, useRef, useState } from 'react';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { linter, type Diagnostic } from '@codemirror/lint';
import { applyText, parseText, printText, serializeDiagram, type TextError } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { diagramText } from './language.ts';
import { Icon } from '../ui/Icon.tsx';
import { SideTabs } from '../notes/NotesPanel.tsx';

/** Marks a change that came from the canvas, so it is not read back as typing. */
const fromCanvas = Annotation.define<boolean>();
const APPLY_MS = 400;

function toDiagnostics(view: EditorView, errors: TextError[]): Diagnostic[] {
  const doc = view.state.doc;
  return errors.map((e) => {
    const line = doc.line(Math.min(Math.max(1, e.line), doc.lines));
    const from = Math.min(line.from + e.from, line.to), to = Math.max(from, Math.min(line.from + e.to, line.to));
    return {
      from,
      to: to === from && to < line.to ? to + 1 : to,
      severity: 'error',
      message: e.message,
      actions: e.fix ? [{ name: e.fix.label, apply: (v, a, b) => v.dispatch({ changes: { from: a, to: b, insert: e.fix!.insert } }) }] : [],
    };
  });
}

export default function CodePanel() {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [errors, setErrors] = useState<TextError[]>([]);
  const title = useEditor((s) => s.diagram.title);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false; // typing not applied yet
    let invalid = false; // the text has errors: keep it, do not reprint over it
    let applying = false; // the store change we are making ourselves

    const apply = () => {
      pending = false;
      const view = viewRef.current;
      if (!view) return;
      const s = useEditor.getState();
      const r = applyText(s.diagram, view.state.doc.toString());
      if (!r.ok) { invalid = true; setErrors(r.errors); return; }
      invalid = false;
      setErrors([]);
      if (serializeDiagram(r.diagram) !== serializeDiagram(s.diagram)) {
        applying = true;
        s.commit(r.diagram, 'code');
        applying = false;
      }
    };

    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: printText(useEditor.getState().diagram),
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          diagramText,
          EditorView.lineWrapping, // the panel is narrow: wrap long lines rather than scroll sideways
          linter((v) => { const r = parseText(v.state.doc.toString()); return r.ok ? [] : toDiagnostics(v, r.errors); }, { delay: APPLY_MS }),
          EditorView.contentAttributes.of({ 'aria-label': 'Diagram as text' }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.some((tr) => tr.annotation(fromCanvas))) return;
            pending = true;
            clearTimeout(timer);
            timer = setTimeout(apply, APPLY_MS);
          }),
        ],
      }),
    });
    viewRef.current = view;

    const unsub = useEditor.subscribe((s, prev) => {
      if (s.diagram === prev.diagram || applying || pending || invalid) return;
      const text = printText(s.diagram);
      if (text !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: fromCanvas.of(true) });
      }
    });
    return () => { unsub(); clearTimeout(timer); view.destroy(); viewRef.current = null; };
  }, []);

  const first = errors[0];
  const fixFirst = () => {
    const view = viewRef.current;
    if (!view || !first?.fix) return;
    const [d] = toDiagnostics(view, [first]);
    if (d) view.dispatch({ changes: { from: d.from, to: d.to, insert: first.fix.insert } });
    view.focus();
  };

  return (
    <section className="code-panel" aria-label="Diagram as text">
      <div className="code-head">
        <SideTabs />
        <b className="code-title">{title}</b>
        <span className="spacer" />
        {errors.length > 0 ? (
          <span className="chip chip--bad"><Icon name="x" />{errors.length} {errors.length === 1 ? 'error' : 'errors'}</span>
        ) : (
          <span className="chip chip--ok"><Icon name="check" />In sync</span>
        )}
      </div>
      <div className="code-host" ref={host} />
      {first && (
        <div className="code-msg" role="alert">
          <Icon name="alert" />
          <span>
            <b>Line {first.line}:</b> {first.message} The canvas keeps the last version that was correct.
            {first.fix && <button className="btn btn--sm" type="button" onClick={fixFirst}>{first.fix.label}</button>}
          </span>
        </div>
      )}
    </section>
  );
}
