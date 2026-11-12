// Bundles the Electron main process and the two preloads with esbuild.
// Preloads run sandboxed, so each must be a single self-contained CJS file.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'info',
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js' }),
  build({ ...common, entryPoints: ['src/preload/web.ts'], outfile: 'dist/preload/web.js' }),
  build({ ...common, entryPoints: ['src/preload/shell.ts'], outfile: 'dist/preload/shell.js' }),
]);
