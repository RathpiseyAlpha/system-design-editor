// Present mode: start and stop it (full screen when the browser allows), step through it, and the bar that shows where
// you are. The canvas fits each step; App hides everything else while presenting.
import { useMemo } from 'react';
import { useEditor } from '../state/store.ts';
import { Icon } from '../ui/Icon.tsx';
import { presentSteps } from './steps.ts';

/** True while the page is full screen because Present asked for it (so leaving full screen also leaves Present). */
let ourFullscreen = false;

export function startPresenting() {
  useEditor.getState().present(true);
  const el = document.documentElement;
  if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') {
    el.requestFullscreen().then(() => { ourFullscreen = true; }, () => { /* refused (embedded, or no permission): present in the page */ });
  }
}

export function stopPresenting() {
  useEditor.getState().present(false);
  if (ourFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  ourFullscreen = false;
}

if (typeof document !== 'undefined') {
  // Esc in full screen is taken by the browser, which leaves full screen: leave Present with it.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && ourFullscreen) {
      ourFullscreen = false;
      if (useEditor.getState().presenting) useEditor.getState().present(false);
    }
  });
}

/** Move by `by` steps (or to `to`), staying inside the list. */
export function stepBy(by: number, to?: number) {
  const s = useEditor.getState();
  const last = presentSteps(s.diagram).length - 1;
  s.setStep(Math.max(0, Math.min(last, to ?? s.step + by)));
}

export function PresentBar() {
  const diagram = useEditor((s) => s.diagram);
  const step = useEditor((s) => s.step);
  const steps = useMemo(() => presentSteps(diagram), [diagram]);
  const at = Math.min(step, steps.length - 1);
  return (
    <div className="present-bar" role="toolbar" aria-label="Present">
      <button className="btn btn--icon" type="button" aria-label="Previous" title="Previous (Left arrow)" disabled={at === 0} onClick={() => stepBy(-1)}><Icon name="arrow" className="flip" /></button>
      <span className="present-where" aria-live="polite">
        <b>{steps[at]!.title}</b>
        <small>{at === 0 ? 'Whole diagram' : 'Zone'}, {at + 1} of {steps.length}</small>
      </span>
      <button className="btn btn--icon" type="button" aria-label="Next" title="Next (Right arrow or Space)" disabled={at === steps.length - 1} onClick={() => stepBy(1)}><Icon name="arrow" /></button>
      <span className="vsep" />
      <button className="btn btn--sm" type="button" title="Stop presenting (Esc)" onClick={stopPresenting}><Icon name="x" />Exit</button>
    </div>
  );
}
