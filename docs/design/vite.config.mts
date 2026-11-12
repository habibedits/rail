import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Dev server for the README images: Rail's real screens with fake data
// (panel.html) and the composed product images (shots/*.html).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5181, strictPort: true, fs: { allow: [path.resolve(__dirname, '../..')] } },
});
