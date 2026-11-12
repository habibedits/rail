// Renders pages from the design dev server to PNGs at 2x.
// Usage (with `npx vite --config docs/design/vite.config.mts` running):
//   npx electron docs/design/render.cjs <out-dir> <name>=<path>@<width>x<height> ...
// Example: npx electron docs/design/render.cjs docs/images hero=shots/hero.html@1600x900
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [outDir, ...jobs] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('render.cjs') && a !== '.');
const BASE = process.env.DESIGN_URL || 'http://localhost:5181/';

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // keep going between pages
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  fs.mkdirSync(outDir, { recursive: true });
  for (const job of jobs) {
    const m = /^([\w-]+)=(.+)@(\d+)x(\d+)$/.exec(job);
    if (!m) { console.error('bad job', job); continue; }
    const [, name, page, w, h] = m;
    const win = new BrowserWindow({
      width: Number(w), height: Number(h), show: false, useContentSize: true,
      webPreferences: { offscreen: false, zoomFactor: 1 },
    });
    for (let i = 0; ; i++) {
      try { await win.loadURL(BASE + page); break; } catch (e) { if (i > 4) throw e; await new Promise((r) => setTimeout(r, 1500)); }
    }
    await new Promise((r) => setTimeout(r, Number(process.env.DESIGN_WAIT || 3500)));
    const img = await win.webContents.capturePage();
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, img.toPNG());
    console.log('saved', file, img.getSize());
    win.destroy();
  }
  app.quit();
});
