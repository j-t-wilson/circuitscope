import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'circuitscope/static',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/api': 'http://localhost:8050'
    }
  }
});
