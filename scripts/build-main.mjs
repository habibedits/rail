// Bundles the Electron main process and the two preloads with esbuild.
// Preloads run sandboxed, so each must be a single self-contained CJS file.
import fs from 'node:fs';
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

// Mail: the Google OAuth client you made once in Google Cloud (see README → Mail).
// Drop the file Google downloads (client_secret_….json) or google-client.json in
// the repo folder; it's built into this copy of Rail so Mail goes straight to
// "Sign in with Google". Both names are gitignored: the file never leaves your Mac.
const found = fs.readdirSync('.').filter((f) => f === 'google-client.json' || /^client_secret_.*\.json$/.test(f)).sort();
const out = 'dist/main/google-client.json';
if (found.length) {
  const file = found.includes('google-client.json') ? 'google-client.json' : found[found.length - 1];
  let client;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const c = j.installed ?? j.web ?? j;
    client = { id: String(c.client_id ?? ''), secret: String(c.client_secret ?? '') };
  } catch {
    client = null;
  }
  if (!client || !/\.apps\.googleusercontent\.com$/.test(client.id) || !client.secret) {
    console.error(`\n✖ ${file} isn't a Google OAuth client file. Download it again from Google Cloud → Clients (type: Desktop app).\n`);
    process.exit(1);
  }
  fs.writeFileSync(out, JSON.stringify(client));
  console.log(`\n✓ Mail: built in the Google sign-in from ${file}\n`);
} else {
  fs.rmSync(out, { force: true });
  console.log('\n· Mail: no Google client file in this folder, so the Mail space will ask for one (see README → Mail).\n');
}
