// The worker side of runner.ts: one job in, one answer out, then the runner ends the thread.
import { parentPort } from 'node:worker_threads';
import { checkDiagram } from '@archboard/engine';

parentPort!.once('message', (job: { diagram: unknown; ruleset: unknown }) => {
  parentPort!.postMessage(checkDiagram(job.diagram, job.ruleset));
});
