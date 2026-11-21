// A side panel (text or notes) is loaded only when first opened. If that load fails (no network before the offline copy is
// ready, or a browser without service workers), only the panel says so and offers Retry; the canvas keeps working.
import { Component, type ReactNode } from 'react';

interface State { failed: boolean; attempt: number }

export class PanelBoundary extends Component<{ children: (attempt: number) => ReactNode }, State> {
  state: State = { failed: false, attempt: 0 };
  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children(this.state.attempt);
    return (
      <div className="code-panel code-loading" role="alert">
        <span>This panel could not be loaded. Check the network, then try again. The canvas still works.</span>
        <button className="btn btn--sm" type="button" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>Retry</button>
      </div>
    );
  }
}
