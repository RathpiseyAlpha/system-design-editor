// "Works offline once loaded" (SPEC section 9): the build writes sw.js, a service worker that keeps a copy of every file of
// this build (scripts, styles, fonts, icons, the layout worker, both pages). A classroom network that drops after the page
// opened, or a page reopened offline, still gets the text view, the notes, auto-layout and every icon pack.
// Pages are fetched network first (a new build is seen at once); files with a hash in their name come from the copy.
// Each build gets its own cache name, and the older ones are deleted when the new worker takes over.
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

const SW = (cache: string, files: string[]) => `// Written by the build (apps/editor/offline.ts). Do not edit.
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('archboard-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // The page's query (?mode=view&origin=...) is the host's, not part of the file.
    e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error())));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
`;

export function offline(): Plugin {
  return {
    name: 'archboard-offline',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      // woff2 is enough for every browser the editor supports; source maps are for developers.
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.endsWith('.woff')).sort();
      const pages = files.filter((f) => f.endsWith('index.html')).map((f) => f.replace(/index\.html$/, '') || './');
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: SW(`archboard-${version}`, [...pages, ...files]) });
    },
  };
}
