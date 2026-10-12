import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The wall tablet runs Android WebView 106 — keep JS output within Chromium 106.
// CSS targets chrome61 on purpose: the tablet's WebView rejects 4/8-digit hex colours (#0000,
// #ffffffbf) even though Chrome 106 should support them, and a newer target lets the minifier
// rewrite transparent/rgba() into that form. Verified on-device with CSS.supports().
export default defineConfig({
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  // `npm run dev` + `npm run server` in another terminal: the API is proxied to the Node server.
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/photos': 'http://localhost:8787',
      '/plex-art': 'http://localhost:8787',
    },
  },
});
