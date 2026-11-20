import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The editor is a static single-page app (SPEC section 10). It reads the shared design tokens and icons from ../../design,
// so the dev server may serve files from the repository root. `base: './'` lets the build run from any folder (GitHub Pages).
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { fs: { allow: [repo] } },
  // Icons stay separate files (loaded only when shown) instead of being inlined into the script.
  build: { target: 'es2022', sourcemap: true, assetsInlineLimit: (file) => (file.endsWith('.svg') ? false : undefined) },
});
