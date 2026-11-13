import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
