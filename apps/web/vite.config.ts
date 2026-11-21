import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // New builds activate on the next load (skipWaiting + clientsClaim).
      registerType: 'autoUpdate',
      // Registration is done in src/main.tsx (production only), so no injected script.
      injectRegister: false,
      // No service worker on `npm run dev`.
      devOptions: { enabled: false },
      manifest: {
        name: 'Knightfall',
        short_name: 'Knightfall',
        description: 'Chess trainer: rated puzzles, daily, rush, live battle and a Stockfish game review.',
        theme_color: '#0f1420',
        background_color: '#0f1420',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell (html/js/css incl. worker chunks) and piece images. Never the engine, puzzles or openings.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['engine/**', 'puzzles/**', 'openings.json'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/engine(\/|$)/, /^\/ws(\/|$)/],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && (url.pathname.startsWith('/puzzles/') || url.pathname === '/openings.json' || url.pathname === '/opening-lines.json'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'kf-data', cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/engine/'),
            handler: 'CacheFirst',
            options: { cacheName: 'kf-engine', cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      // Knightfall server JSON API (chess.com game lookup for Game Review).
      '/api': 'http://localhost:8787',
    },
  },
});
