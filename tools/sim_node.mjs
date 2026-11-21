// Run a scenario on a diagram in Node with the engine's own source (bundled on the fly by esbuild), and print the summary
// and the trace (served/p95 per second): what tools/check_sim.py compares with the browser's Web Worker, number for number.
//   node tools/sim_node.mjs <diagram.json> <scenario.json>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = await build({
  stdin: { contents: "export { simulate, parseDiagram } from './packages/engine/src/index.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
});
const { simulate, parseDiagram } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const [diagramPath, scenarioPath] = process.argv.slice(2);
const d = parseDiagram(JSON.parse(readFileSync(diagramPath, 'utf8')));
if (!d.ok) { console.log(JSON.stringify({ errors: d.errors })); process.exit(1); }
const r = simulate(d.diagram, JSON.parse(readFileSync(scenarioPath, 'utf8')));
if (!r.ok) { console.log(JSON.stringify({ errors: r.errors })); process.exit(1); }
console.log(JSON.stringify({ summary: r.result.summary, trace: r.result.ticks.map((t) => `${t.served}/${t.p95}`).join(' ') }));
