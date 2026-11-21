// Bundle the service into dist/server.js with every dependency inside, so the container needs Node and nothing else.
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/server.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'linked',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
