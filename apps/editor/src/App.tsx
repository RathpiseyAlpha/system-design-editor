import { useEditor } from './state/store.ts';
import { Canvas } from './canvas/Canvas.tsx';
import { Sprite } from './ui/Icon.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { Palette } from './ui/Palette.tsx';
import { Inspector } from './ui/Inspector.tsx';

function StatusBar() {
  const n = useEditor((s) => s.diagram.nodes.length);
  const e = useEditor((s) => s.diagram.edges.length);
  const z = useEditor((s) => s.diagram.zones.length);
  return (
    <footer className="statusbar">
      <span className="chip">{n} blocks</span>
      <span className="chip">{e} connections</span>
      <span className="chip">{z} zones</span>
      <span className="spacer" />
      <span>Drag the canvas to pan, scroll to zoom, Tab to move between blocks</span>
    </footer>
  );
}

export function App() {
  return (
    <div className="app">
      <Sprite />
      <TopBar />
      <div className="body3">
        <Palette />
        <Canvas />
        <Inspector />
      </div>
      <StatusBar />
    </div>
  );
}
