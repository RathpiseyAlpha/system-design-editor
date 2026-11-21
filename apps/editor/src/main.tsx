import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles/app.css';
import { App } from './App.tsx';
import { startEmbedHost } from './embed/host.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// In an embed, listen to the host page only after the editor is there to show what it sends.
startEmbedHost();

// Keep a copy of this build for offline use (offline.ts). Only in a build: the dev server's files change all the time.
// Registered after load, so it never competes with the first paint. sw.js sits next to index.html, one level above assets/
// (a string, not new URL(..., import.meta.url), which the build would try to bundle).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { navigator.serviceWorker.register(import.meta.url.replace(/assets\/[^/]*$/, 'sw.js')).catch(() => {}); });
}
