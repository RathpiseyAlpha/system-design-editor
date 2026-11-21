import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { offline } from './offline.ts';

// The editor is a static single-page app (SPEC section 10). It reads the shared design tokens and icons from ../../design,
// so the dev server may serve files from the repository root. `base: './'` lets the build run from any folder (GitHub Pages).
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react(), offline()],
  server: { fs: { allow: [repo] } },
  // Icons stay separate files (loaded only when shown) instead of being inlined into the script.
  // Two pages, one app: the editor, and /embed/ (the read-only view a host page puts in an iframe, SPEC section 8.1).
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: (file) => (file.endsWith('.svg') ? false : undefined),
    rollupOptions: { input: { main: fileURLToPath(new URL('index.html', import.meta.url)), embed: fileURLToPath(new URL('embed/index.html', import.meta.url)) } },
  },
});
