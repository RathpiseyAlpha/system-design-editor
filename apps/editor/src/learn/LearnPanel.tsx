// Learning mode's panel (design page, Screen C): the host's brief, Check, and a result per rule. The check runs here in the
// browser and is indicative: the host scores the handed-in diagram on its server with its own copy of the rules
// (SPEC section 8, decision 9). The last result stays until the next Check, and says when the diagram changed since.
import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '../state/store.ts';
import { parseMarkdown } from '../notes/markdown.ts';
import { block } from '../notes/MarkdownView.tsx';
import { Icon } from '../ui/Icon.tsx';

function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  return min < 1 ? 'Checked just now' : min === 1 ? 'Checked 1 minute ago' : min < 60 ? `Checked ${min} minutes ago` : `Checked at ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function LearnPanel() {
  const learn = useEditor((s) => s.learn);
  const changed = useEditor((s) => !!s.learn?.checked && s.learn.checked !== s.diagram);
  const check = useEditor((s) => s.check);
  const brief = useMemo(() => parseMarkdown(learn?.brief?.text ?? ''), [learn?.brief?.text]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  if (!learn) return null;
  const { rules, result } = learn;
  const byId = new Map(result?.results.map((r) => [r.id, r]) ?? []);

  return (
    <aside className="learn-panel" aria-label="Challenge">
      <div className="learn-head">
        {learn.brief?.label && <p className="learn-label">{learn.brief.label}</p>}
        <h2>{learn.brief?.title ?? rules?.title ?? 'Challenge'}</h2>
      </div>
      {brief.length > 0 && <div className="learn-brief notes-view">{brief.map(block)}</div>}
      {rules ? (
        <>
          <div className="score">
            <span>
              <span className="score-when">{result && learn.checkedAt ? ago(learn.checkedAt, now) : 'Not checked yet'}</span>
              <b>{result ? `${result.score} / ${result.max}` : `– / ${rules.rules.reduce((s, r) => s + r.points, 0)}`}</b>
            </span>
            <button className="btn btn--primary" type="button" onClick={check}><Icon name="check" />Check</button>
          </div>
          {changed && <p className="learn-stale" role="status">The diagram changed since this check. Press Check again.</p>}
          <ul className="rules" aria-label="Checks">
            {rules.rules.map((r) => {
              const got = byId.get(r.id);
              return (
                <li key={r.id} className={got && !got.pass ? 'fail' : undefined}>
                  {!got ? <span className="chip">{r.points} pt{r.points === 1 ? '' : 's'}</span>
                    : got.pass ? <span className="chip chip--ok"><Icon name="check" />Met</span>
                    : <span className="chip chip--warn"><Icon name="alert" />Not met</span>}
                  <span>
                    {r.text}
                    {got && <small>{got.message}{!got.pass && r.hint ? ` ${r.hint}` : ''}</small>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="learn-note">Indicative: your teacher's check of the handed-in diagram is the one that counts.</p>
        </>
      ) : (
        <p className="learn-note">This challenge has no checks to run here.</p>
      )}
    </aside>
  );
}
