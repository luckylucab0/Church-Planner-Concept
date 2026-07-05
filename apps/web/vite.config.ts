import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev laufen API (:3000) und Web (:5173) getrennt; der Proxy hält
    // alle Requests same-origin, sodass Session-Cookies wie in Produktion
    // (hinter Caddy) funktionieren.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
