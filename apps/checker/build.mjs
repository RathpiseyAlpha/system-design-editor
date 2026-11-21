// Bundle the service and its worker into dist/: two plain JavaScript files with every dependency inside, so the container
// needs Node and nothing else (no node_modules, no TypeScript at run time).
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/server.ts', worker: 'src/worker.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'linked',
  // Some bundled CommonJS code calls require(); give the ES module a require of its own.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
