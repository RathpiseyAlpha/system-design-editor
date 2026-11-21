// The diagram's notes: a Markdown document kept in the file (diagram.notes). Write is a plain text area; Preview draws the
// note from parseMarkdown's tree as React elements, so nothing in a note is ever read as HTML.
import { useMemo, useState } from 'react';
import { LIMITS } from '@archboard/engine';
import { useEditor } from '../state/store.ts';
import { Icon } from '../ui/Icon.tsx';
import { parseMarkdown } from './markdown.ts';
import { block } from './MarkdownView.tsx';

/** Text and Notes: which of the diagram's two documents the side panel shows. */
export function SideTabs() {
  const side = useEditor((s) => s.side);
  const set = useEditor.getState().setSide;
  return (
    <div className="seg side-tabs" role="group" aria-label="Side panel">
      <button type="button" aria-pressed={side === 'text'} onClick={() => set('text')}><Icon name="code" /><span>Text</span></button>
      <button type="button" aria-pressed={side === 'notes'} onClick={() => set('notes')}><Icon name="note" /><span>Notes</span></button>
    </div>
  );
}

export function NotesPanel() {
  const notes = useEditor((s) => s.diagram.notes ?? '');
  const [mode, setMode] = useState<'write' | 'preview'>(() => (notes ? 'preview' : 'write'));
  const blocks = useMemo(() => (mode === 'preview' ? parseMarkdown(notes) : []), [mode, notes]);
  return (
    <section className="code-panel notes-panel" aria-label="Diagram notes">
      <div className="code-head">
        <SideTabs />
        <span className="spacer" />
        {mode === 'write' ? (
          <button className="btn btn--sm" type="button" title="See the notes as they read" onClick={() => setMode('preview')}><Icon name="window" />Preview</button>
        ) : (
          <button className="btn btn--sm" type="button" title="Change the notes" onClick={() => setMode('write')}><Icon name="pencil" />Edit</button>
        )}
      </div>
      {mode === 'write' ? (
        <textarea
          className="notes-input"
          aria-label="Notes, in Markdown"
          placeholder={'Why the diagram looks like this, in Markdown.\n\n# A heading\n- a point\n**bold**, *italic*, `code`, [a link](https://example.org)'}
          maxLength={LIMITS.docNotes}
          value={notes}
          onChange={(e) => useEditor.getState().setNotes(e.target.value)}
        />
      ) : (
        <div className="notes-view" tabIndex={0} aria-label="Notes preview">
          {blocks.length ? blocks.map(block) : <p className="muted">No notes yet. Press Edit to add some.</p>}
        </div>
      )}
      <div className="notes-foot">
        <span>Markdown: <code>#</code> heading, <code>-</code> list, <code>**bold**</code>, <code>*italic*</code>, <code>`code`</code>, https links.</span>
        <span className="muted">{notes.length.toLocaleString()} / {LIMITS.docNotes.toLocaleString()}</span>
      </div>
    </section>
  );
}

export default NotesPanel;
