import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer for Rail's own UI only (top strip, divider bar, Meetings panel).
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
