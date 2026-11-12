import {
  app,
  BaseWindow,
  clipboard,
  dialog,
  Display,
  Menu,
  Notification,
  globalShortcut,
  powerMonitor,
  ipcMain,
  Rectangle,
  screen,
  session,
  shell,
  View,
  WebContents,
  WebContentsView,
} from 'electron';
import path from 'node:path';
import { Config, loadConfig, saveConfig } from './config';
import { arcInstalled, importFromArc } from './arcImport';
import { getSecret, setSecret } from './secrets';
import * as ff from './fireflies';
import * as ncal from './notionCal';
import * as focusTimer from './focus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STRIP_H = 28; // top strip: space dots, name, pane actions, pin, hide
const DIVIDER_H = 24; // Notion pane header (back/forward, recent pages)
const MIN_W = 320; // claude.ai's narrow layout stays usable at this width
const SLIDE_MS = 250;
const HOTKEY = 'Control+`';
const BG = '#f5f5f4';

const DEV_URL = process.env.RAIL_DEV_URL;
const PRELOAD_WEB = path.join(__dirname, '../preload/web.js');
const PRELOAD_SHELL = path.join(__dirname, '../preload/shell.js');
const RENDERER_HTML = path.join(__dirname, '../renderer/index.html');

const CLAUDE_URL = 'https://claude.ai';
const NOTION_URL = 'https://app.notion.com';
const SLACK_URL = 'https://app.slack.com/client';
const SLACK_HOSTS = ['slack.com', 'slack-edge.com'];
// Only the Slack client itself stays in the pane; file/canvas/huddle links
// opened in a new tab go to the browser instead of replacing the client.
const SLACK_IN_PANE = ['app.slack.com'];
const CLAUDE_HOSTS = ['claude.ai', 'claude.com', 'anthropic.com'];
const NOTION_HOSTS = ['notion.so', 'notion.com', 'notion.site'];
// Sign-in providers that may open as popups from inside a pane (PRD §7).
const AUTH_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com'];

// Notion Calendar's web app: its links are not Notion pages.
const CALENDAR_HOSTS = ['calendar.notion.so', 'cron.com'];

const SPACES = [
  { id: 'claude', name: 'Claude' },
  { id: 'notion', name: 'Notion' },
  { id: 'meetings', name: 'Meetings' },
  { id: 'slack', name: 'Slack' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'focus', name: 'Focus' }, // always last
] as const;

// Opt-in only: a debugging port exposes logged-in sessions to local processes.
if (process.env.RAIL_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.RAIL_DEBUG_PORT);

// Present as a normal stable Chrome so sites serve their usual layouts.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s*Electron\/\S+/i, '')
  .replace(new RegExp(`\\s*${app.getName()}\\/\\S+`, 'i'), '');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let cfg: Config;
let win: BaseWindow;
let strip: WebContentsView;
let divider: WebContentsView;
let claude: WebContentsView;
let notion: WebContentsView;
let meetings: WebContentsView;
const containers: View[] = [];
const shellIds = new Set<number>();

let active = 0;
let animating = false;
let shown = true;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hostMatches(url: string, hosts: string[]) {
  try {
    const h = new URL(url).hostname;
    return hosts.some((x) => h === x || h.endsWith('.' + x));
  } catch {
    return false;
  }
}

function loadShell(view: WebContentsView, name: string) {
  if (DEV_URL) view.webContents.loadURL(`${DEV_URL}/?view=${name}`);
  else view.webContents.loadFile(RENDERER_HTML, { query: { view: name } });
}

function createShellView(name: string) {
  const view = new WebContentsView({
    webPreferences: { preload: PRELOAD_SHELL, contextIsolation: true, sandbox: true },
  });
  view.setBackgroundColor(BG);
  shellIds.add(view.webContents.id);
  attachKeys(view.webContents);
  // A shell page whose first load fails (seen right after reinstalling the app)
  // would stay blank: retry a few times, and reload after a renderer crash.
  let tries = 0;
  const retry = () => { if (tries++ < 5) setTimeout(() => !view.webContents.isDestroyed() && loadShell(view, name), 300 * tries); };
  view.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => { if (isMainFrame && code !== -3) retry(); });
  view.webContents.on('did-finish-load', () => { if (view.webContents.getURL().startsWith('about:')) retry(); else tries = 0; });
  view.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') { tries = 0; retry(); } });
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (e, url) => { // Rail's own UI never navigates away
    e.preventDefault();
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
  });
  loadShell(view, name);
  return view;
}

function createSiteView(partition: string, url: string, ownHosts: string[], inPaneHosts = ownHosts) {
  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: PRELOAD_WEB,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
    },
  });
  view.setBackgroundColor('#ffffff');
  const wc = view.webContents;
  attachKeys(wc);
  wireLinks(wc, ownHosts, inPaneHosts);
  wireCrashRecovery(view, url);
  if (DEV_URL) {
    const tag = `[rail:${partition.split(':')[1]}]`;
    wc.on('did-start-navigation', (d) => d.isMainFrame && console.log(tag, 'nav', d.url));
    wc.on('did-fail-load', (_e, code, desc, u, main) => main && console.log(tag, 'fail', code, desc, u));
    wc.on('did-finish-load', () => console.log(tag, 'loaded', wc.getURL()));
  }
  wc.loadURL(url);
  return view;
}

// External links → default browser; same-site new windows → stay in the pane;
// sign-in providers → small popup in the same session.
function wireLinks(wc: WebContents, ownHosts: string[], inPaneHosts: string[]) {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    // A real popup (window.open with features), e.g. Notion/Google sign-in,
    // must stay a popup so it can hand the result back to its opener.
    const isPopup = disposition === 'new-window';
    if (hostMatches(url, AUTH_HOSTS) || (isPopup && hostMatches(url, ownHosts))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 480, height: 680, autoHideMenuBar: true },
      };
    }
    if (hostMatches(url, inPaneHosts)) {
      wc.loadURL(url);
      return { action: 'deny' };
    }
    if (routeToNotion(wc, url)) return { action: 'deny' };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    if (!/^https?:/.test(url)) {
      // Never hand control to another app unasked; notion:// opens in Rail's Notion pane.
      e.preventDefault();
      if (url.startsWith('notion:')) openNotionLink(url);
      else if (/^mailto:|^tel:/.test(url)) shell.openExternal(url);
      return;
    }
    if (hostMatches(url, ownHosts) || hostMatches(url, AUTH_HOSTS)) return;
    e.preventDefault();
    if (!routeToNotion(wc, url)) shell.openExternal(url);
  });
}

// A Notion page link clicked in another pane (Calendar's meeting notes, Slack,
// Claude) opens in Rail's Notion pane instead of the browser.
function routeToNotion(from: WebContents, url: string) {
  if (!notion || from === notion.webContents) return false;
  if (!hostMatches(url, NOTION_HOSTS) || hostMatches(url, CALENDAR_HOSTS)) return false;
  if (!/^https:\/\/(www\.|app\.)?notion\.(so|com)\//.test(url)) return false;
  if (/\/(login|signup|calendarAuth|oauth|auth)\b/i.test(url)) return false;
  showNotionPage(url);
  return true;
}

function wireCrashRecovery(view: WebContentsView, fallbackUrl: string) {
  view.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    console.warn('[rail] pane crashed, reloading', details.reason);
    setTimeout(() => view.webContents.loadURL(fallbackUrl), 500);
  });
  // A failed main-page load (offline at launch, a hiccup right after
  // reinstalling) would leave the pane blank: retry with backoff.
  let tries = 0;
  view.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || tries >= 6) return; // -3 = navigation replaced by another
    tries += 1;
    setTimeout(() => { if (!view.webContents.isDestroyed()) view.webContents.loadURL(url && url.startsWith('http') ? url : fallbackUrl); }, 2000 * tries);
  });
  view.webContents.on('did-finish-load', () => { tries = 0; });
}

// Ctrl+Option+←/→ and Ctrl+1/2 work whenever any part of Rail has focus.
function attachKeys(wc: WebContents) {
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.alt && !input.meta) {
      if (input.key === 'ArrowRight') { e.preventDefault(); goTo(active + 1); }
      else if (input.key === 'ArrowLeft') { e.preventDefault(); goTo(active - 1); }
      return;
    }
    if (input.control && !input.alt && !input.meta && !input.shift) {
      const m = /^Digit([1-9])$/.exec(input.code);
      if (m) {
        const i = Number(m[1]) - 1;
        if (i < SPACES.length) { e.preventDefault(); goTo(i); }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Docking (M1)
// ---------------------------------------------------------------------------

function dockBounds(display: Display): Rectangle {
  const wa = display.workArea;
  const width = Math.min(wa.width, Math.max(MIN_W, Math.round(wa.width * cfg.widthPct)));
  return { x: wa.x + wa.width - width, y: wa.y, width, height: wa.height };
}

function currentDisplay() {
  return screen.getDisplayMatching(win.getBounds());
}

function redock() {
  if (!shown) return;
  win.setBounds(dockBounds(currentDisplay()));
}

function showRail() {
  // Appear on whichever display the pointer is on.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const target = dockBounds(display);
  win.setBounds({ ...target, x: target.x + target.width });
  win.show();
  win.setBounds(target, true); // native macOS slide
  shown = true;
  focusActive();
}

function hideRail() {
  const b = win.getBounds();
  shown = false;
  win.setBounds({ ...b, x: b.x + b.width }, true);
  setTimeout(() => { if (!shown) win.hide(); }, 220);
}

function setPinned(on: boolean) {
  cfg.alwaysOnTop = on;
  win.setAlwaysOnTop(on, 'floating');
  saveConfig(cfg);
  broadcast();
}

// ---------------------------------------------------------------------------
// Layout (M2)
// ---------------------------------------------------------------------------

function size() {
  const b = win.getContentBounds();
  return { w: b.width, h: b.height, ch: b.height - STRIP_H };
}

function layout() {
  const { w, ch } = size();
  strip.setBounds({ x: 0, y: 0, width: w, height: STRIP_H });
  if (!animating) {
    containers.forEach((c, i) => {
      c.setBounds({ x: i === active ? 0 : w, y: STRIP_H, width: w, height: ch });
      c.setVisible(i === active);
    });
  }
  layoutWork(w, ch);
  meetings.setBounds({ x: 0, y: 0, width: w, height: ch });
  slack?.setBounds({ x: 0, y: 0, width: w, height: ch });
  calendar.setBounds({ x: 0, y: 0, width: w, height: ch });
  focusView.setBounds({ x: 0, y: 0, width: w, height: ch });
}

// Claude and Notion each get a whole space; Notion keeps its header bar.
function layoutWork(w: number, h: number) {
  claude.setBounds({ x: 0, y: 0, width: w, height: h });
  divider.setBounds({ x: 0, y: 0, width: w, height: DIVIDER_H });
  notion.setBounds({ x: 0, y: DIVIDER_H, width: w, height: Math.max(0, h - DIVIDER_H) });
}

const spaceIndex = (id: (typeof SPACES)[number]['id']) => SPACES.findIndex((sp) => sp.id === id);

// ---------------------------------------------------------------------------
// Notion links (notion://…), e.g. Notion Calendar's "Open meeting note"
// ---------------------------------------------------------------------------

let ready = false;
let pendingNotionLink: string | null = null;

/** notion://www.notion.so/Page-123 → https://www.notion.so/Page-123 (null if not a page link). */
function notionLinkToHttps(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'notion:') return null;
  // notion://www.notion.so/path, notion://notion.so/path, or notion:///path
  const host = /(^|\.)notion\.(so|com|site)$/.test(u.hostname) ? u.hostname : 'www.notion.so';
  const pathPart = /(^|\.)notion\.(so|com|site)$/.test(u.hostname) || !u.hostname ? u.pathname : `/${u.hostname}${u.pathname}`;
  return `https://${host}${pathPart}${u.search}${u.hash}`;
}

function openNotionLink(raw: string) {
  if (!ready) { pendingNotionLink = raw; return; }
  const url = notionLinkToHttps(raw);
  if (url) showNotionPage(url);
}

function showNotionPage(url: string) {
  if (!shown || !win.isVisible()) showRail();
  app.focus({ steal: true });
  goTo(spaceIndex('notion'));
  notion.webContents.loadURL(url);
  notion.webContents.focus();
}

// Must be registered before ready: macOS delivers launch-time links early.
app.on('open-url', (e, url) => {
  e.preventDefault();
  openNotionLink(url);
});


// ---------------------------------------------------------------------------
// Spaces (M3)
// ---------------------------------------------------------------------------

function goTo(index: number) {
  const target = Math.max(0, Math.min(SPACES.length - 1, index));
  if (target === active || animating) return;
  if (SPACES[target].id === 'slack') ensureSlack();

  const { w, ch } = size();
  const from = containers[active];
  const to = containers[target];
  const dir = target > active ? 1 : -1;

  active = target;
  cfg.activeSpace = target;
  saveConfig(cfg);
  broadcast();

  animating = true;
  to.setBounds({ x: dir * w, y: STRIP_H, width: w, height: ch });
  to.setVisible(true);
  const start = Date.now();
  const tick = () => {
    const t = Math.min(1, (Date.now() - start) / SLIDE_MS);
    const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
    from.setBounds({ x: Math.round(-dir * w * e), y: STRIP_H, width: w, height: ch });
    to.setBounds({ x: Math.round(dir * w * (1 - e)), y: STRIP_H, width: w, height: ch });
    if (t < 1) {
      setTimeout(tick, 8);
    } else {
      animating = false;
      layout();
      focusActive();
    }
  };
  tick();
}

function focusActive() {
  const id = SPACES[active].id;
  const wc = id === 'claude' ? claude.webContents
    : id === 'notion' ? notion.webContents
    : id === 'slack' && slack ? slack.webContents
    : id === 'calendar' ? calendar.webContents
    : id === 'focus' ? focusView.webContents
    : meetings.webContents;
  wc.focus();
}

// ---------------------------------------------------------------------------
// Shell <-> main messaging
// ---------------------------------------------------------------------------

function state() {
  return {
    spaces: SPACES.map((s) => ({
      id: s.id,
      name: s.name,
      badge: s.id === 'slack' ? slackUnread : 0, // no indicator on the Calendar dot (user preference)
    })),
    active,
    pinned: cfg.alwaysOnTop,
    collapsed: cfg.collapsed,
    notion: notionNavState(),
  };
}

// ---------------------------------------------------------------------------
// Notion navigation: back/forward + a trail of recent pages
// ---------------------------------------------------------------------------

const TRAIL_MAX = 15;
let notionTitle = '';

function notionPageKey(url: string) {
  try {
    const u = new URL(url);
    const peek = u.searchParams.get('p');
    if (peek) return peek;
    const m = u.pathname.match(/([0-9a-f]{32})$/i);
    return m ? m[1] : u.pathname;
  } catch {
    return url;
  }
}

function notionNavState() {
  const wc = notion?.webContents;
  const ok = wc && !wc.isDestroyed();
  return {
    title: notionTitle || 'Notion',
    canBack: !!(ok && wc.navigationHistory.canGoBack()),
    canForward: !!(ok && wc.navigationHistory.canGoForward()),
  };
}

// Reads the open page's title (the peek's, if one is open) from the pane.
async function refreshNotionTrail() {
  const wc = notion?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const url = wc.getURL();
  let title = '';
  try {
    title = await wc.executeJavaScript(`(() => {
      const h = document.querySelector('.notion-peek-renderer h1, .layout-side-peek h1')
        || document.querySelector('.notion-frame h1');
      return (h && h.innerText || document.title || '').trim();
    })()`);
  } catch {}
  title = title.replace(/\s+/g, ' ').replace(/\s*[|–-]\s*Notion$/, '').slice(0, 80);
  notionTitle = title;
  if (title && title !== 'Notion' && hostMatches(url, NOTION_HOSTS) &&
      !/login|signup|redirect|popup|verify|oauth|callback|auth/i.test(url) &&
      !/^https:\/\/(www\.)?notion\.com(\/|$)/.test(url)) {
    const key = notionPageKey(url);
    cfg.notionTrail = [{ url, title }, ...cfg.notionTrail.filter((v) => notionPageKey(v.url) !== key)].slice(0, TRAIL_MAX);
    saveConfig(cfg);
  }
  broadcast();
}

let trailTimer: NodeJS.Timeout | undefined;
function scheduleTrail() {
  clearTimeout(trailTimer);
  trailTimer = setTimeout(refreshNotionTrail, 700); // let Notion render the title
}

function showNotionTrail() {
  const wc = notion.webContents;
  const current = notionPageKey(wc.getURL());
  const items: Electron.MenuItemConstructorOptions[] = cfg.notionTrail.map((v) => ({
    label: v.title,
    type: 'checkbox',
    checked: notionPageKey(v.url) === current,
    click: () => wc.loadURL(v.url),
  }));
  if (items.length === 0) items.push({ label: 'No recent pages yet', enabled: false });
  items.push(
    { type: 'separator' },
    { label: 'Notion Home', click: () => wc.loadURL(NOTION_URL) },
    { label: 'Open in Browser', click: () => paneAction('notion', 'external') },
    { label: 'Open in Notion App', click: () => paneAction('notion', 'app') },
    { type: 'separator' },
    { label: 'Clear Recent Pages', enabled: cfg.notionTrail.length > 0, click: () => { cfg.notionTrail = []; saveConfig(cfg); } },
  );
  const d = divider.getBounds();
  Menu.buildFromTemplate(items).popup({ window: win, x: 44, y: STRIP_H + d.y + DIVIDER_H });
}

// Up / down through Notion's page tree (the Notion header's ↑ and ↓).
// Up = the page this one sits in (the last link in Notion's own breadcrumb).
// Down = pages, meeting notes and linked pages inside this page.
const NOTION_PARENT = `(() => {
  const here = location.pathname.match(/[0-9a-f]{32}/)?.[0];
  const links = [...document.querySelectorAll('.notion-topbar a[href], header a[href]')]
    .filter((a) => { const id = (a.getAttribute('href') || '').match(/[0-9a-f]{32}/)?.[0]; return id && id !== here; });
  const a = links.pop();
  return a ? { url: a.href, title: a.textContent.trim() || 'Parent page' } : null;
})()`;
const NOTION_CHILDREN = `(() => {
  const here = location.pathname.match(/[0-9a-f]{32}/)?.[0];
  const frame = document.querySelector('.notion-frame');
  if (!frame) return [];
  const out = [], seen = new Set([here]);
  const add = (id, title, kind) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ url: location.origin + '/p/' + id, title: (title || '').replace(/\\s+/g, ' ').trim().slice(0, 70) || 'Untitled', kind });
  };
  for (const b of frame.querySelectorAll('[class*="notion-meeting_note"][data-block-id]')) {
    const t = b.querySelector('h1, h2, h3, [placeholder]')?.textContent || b.textContent;
    add(b.getAttribute('data-block-id').replace(/-/g, ''), t, 'Meeting note');
  }
  for (const b of frame.querySelectorAll('.notion-page-content [class*="notion-collection_view"][data-block-id]')) {
    const t = b.querySelector('[contenteditable], [placeholder]')?.textContent || b.textContent.slice(0, 60);
    add(b.getAttribute('data-block-id').replace(/-/g, ''), t, 'Database');
  }
  for (const a of frame.querySelectorAll('.notion-page-content a[href], .notion-page-block a[href], .notion-alias-block a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!/^\\/|^https:\\/\\/([a-z]+\\.)?notion\\.(so|com)\\//.test(href)) continue; // Notion pages only, not outside links
    const id = href.match(/[0-9a-f]{32}/)?.[0];
    const block = a.closest('[data-block-id]');
    const kind = block?.className.includes('notion-page-block') ? 'Page' : block?.className.includes('alias') ? 'Link' : 'Mention';
    add(id, a.textContent, kind);
  }
  return out.slice(0, 30);
})()`;

async function notionUp() {
  const wc = notion?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const p = await wc.executeJavaScript(NOTION_PARENT).catch(() => null) as { url: string } | null;
  if (p && /^https:\/\/([a-z]+\.)?notion\.(so|com)\//.test(p.url)) wc.loadURL(p.url);
  else shell.beep();
}

async function notionDown() {
  const wc = notion?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const kids = (await wc.executeJavaScript(NOTION_CHILDREN).catch(() => [])) as { url: string; title: string; kind: string }[];
  const ok = kids.filter((k) => /^https:\/\/([a-z]+\.)?notion\.(so|com)\//.test(k.url));
  const items: Electron.MenuItemConstructorOptions[] = ok.length
    ? ok.map((k) => ({ label: k.kind === 'Meeting note' ? `\u{1F4DD}  ${k.title}` : k.title, sublabel: k.kind, click: () => wc.loadURL(k.url) }))
    : [{ label: 'No pages inside this one', enabled: false }];
  const d = divider.getBounds();
  Menu.buildFromTemplate(items).popup({ window: win, x: 60, y: STRIP_H + d.y + DIVIDER_H });
}

function broadcast() {
  const s = state();
  for (const v of [strip, divider, meetings]) {
    if (v && !v.webContents.isDestroyed()) v.webContents.send('rail:state', s);
  }
}

type Cmd =
  | { type: 'hello' }
  | { type: 'goto'; index: number }
  | { type: 'pin' }
  | { type: 'hide' }
  | { type: 'pane'; pane: 'claude' | 'notion'; action: 'back' | 'forward' | 'reload' | 'home' | 'new' | 'external' | 'app' }
  | { type: 'notion-trail' }
  | { type: 'notion-up' }
  | { type: 'notion-down' }
  | { type: 'collapse'; pane: 'claude' | 'notion' }
  | { type: 'divider'; phase: 'start' | 'move' | 'reset'; dy?: number };

function handleCmd(cmd: Cmd) {
  switch (cmd.type) {
    case 'hello':
      broadcast();
      break;
    case 'goto':
      goTo(cmd.index);
      break;
    case 'pin':
      setPinned(!cfg.alwaysOnTop);
      break;
    case 'hide':
      hideRail();
      break;
    case 'collapse':
      break;
    case 'pane':
      paneAction(cmd.pane, cmd.action);
      break;
    case 'notion-trail':
      showNotionTrail();
      break;
    case 'notion-up':
      void notionUp();
      break;
    case 'notion-down':
      void notionDown();
      break;
    case 'divider':
      dividerCmd(cmd.phase, cmd.dy ?? 0);
      break;
  }
}

function paneAction(pane: 'claude' | 'notion', action: string) {
  const wc = (pane === 'claude' ? claude : notion)?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const nav = wc.navigationHistory;
  switch (action) {
    case 'back':
      if (nav.canGoBack()) nav.goBack();
      break;
    case 'forward':
      if (nav.canGoForward()) nav.goForward();
      break;
    case 'reload':
      wc.reload();
      break;
    case 'new':
      wc.loadURL(`${CLAUDE_URL}/new`);
      break;
    case 'home':
      wc.loadURL(pane === 'claude' ? CLAUDE_URL : NOTION_URL);
      break;
    case 'external':
      shell.openExternal(wc.getURL());
      break;
    case 'app': {
      // Open the current page in the Notion desktop app.
      const url = wc.getURL().replace(/^https:\/\/(www\.notion\.so|app\.notion\.com)/, 'notion://www.notion.so');
      if (url.startsWith('notion://')) shell.openExternal(url);
      break;
    }
  }
}

function dividerCmd(_phase: 'start' | 'move' | 'reset', _dy: number) {
  // The Notion header no longer resizes anything (Claude and Notion are separate spaces).
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// Pane factories. If a page destroys its own pane (e.g. a sign-in page calling
// window.close()), rebuild it in place instead of leaving a dead view behind.
function makeClaude(): WebContentsView {
  const view = createSiteView('persist:claude', CLAUDE_URL, CLAUDE_HOSTS);
  view.webContents.once('destroyed', () => rebuildPane('claude', view));
  return view;
}

function makeNotion(): WebContentsView {
  const view = createSiteView('persist:notion', cfg.notionLastUrl ?? NOTION_URL, NOTION_HOSTS);
  // Remember the last Notion page so it reopens on launch.
  const remember = (_e: unknown, url: string) => {
    if (
      hostMatches(url, NOTION_HOSTS) &&
      /^https:/.test(url) &&
      // www.notion.com / notion.com are marketing pages, not workspace pages.
      !/^https:\/\/(www\.)?notion\.com(\/|$)/.test(url) &&
      !/login|signup|redirect|popup|verify|oauth|callback|auth/i.test(url)
    ) {
      cfg.notionLastUrl = url;
      saveConfig(cfg);
    }
  };
  view.webContents.on('did-navigate', remember);
  view.webContents.on('did-navigate-in-page', remember);
  view.webContents.on('did-navigate', scheduleTrail);
  view.webContents.on('did-navigate-in-page', scheduleTrail);
  view.webContents.on('page-title-updated', scheduleTrail);
  view.webContents.once('destroyed', () => rebuildPane('notion', view));
  return view;
}

let quitting = false;
function rebuildPane(pane: 'claude' | 'notion', dead: WebContentsView) {
  if (quitting) return;
  setTimeout(() => {
    if (quitting) return;
    console.warn(`[rail] ${pane} pane was closed by its page; rebuilding`);
    const work = containers[0];
    work.removeChildView(dead);
    if (pane === 'claude') {
      claude = makeClaude();
      work.addChildView(claude, 0);
    } else {
      notion = makeNotion();
      work.addChildView(notion);
    }
    layout();
  }, 50);
}

// ---------------------------------------------------------------------------
// Slack (Space 3). Created on first visit: its web client is heavy.
// ---------------------------------------------------------------------------

let slack: WebContentsView | null = null;
let slackContainer: View;
let slackUnread: number | 'dot' = 0;

function ensureSlack() {
  if (slack) return;
  slack = createSiteView('persist:slack', SLACK_URL, SLACK_HOSTS, SLACK_IN_PANE);
  const view = slack;
  // Slack puts unread state in the tab title: "(3) …" = 3 mentions/DMs,
  // a leading "*" = unread messages without mentions.
  view.webContents.on('page-title-updated', (_e, title) => {
    const m = /^\((\d+)\)/.exec(title.trim());
    const next: number | 'dot' = m ? Number(m[1]) : /^[*!•]/.test(title.trim()) ? 'dot' : 0;
    if (next !== slackUnread) {
      slackUnread = next;
      broadcast();
    }
  });
  view.webContents.once('destroyed', () => {
    if (quitting || slack !== view) return;
    slackContainer.removeChildView(view);
    slack = null;
    slackUnread = 0;
    if (SPACES[active].id === 'slack') setTimeout(() => { ensureSlack(); layout(); }, 50);
  });
  slackContainer.addChildView(view);
  layout();
}

// ---------------------------------------------------------------------------
// Calendar (Space 4): today's Google Calendar events (PRD §6.6), drawn by
// Rail's own UI. Main keeps the events, nudges before meetings and puts a
// countdown on the space's dot.
// ---------------------------------------------------------------------------

let calendar: WebContentsView;
let calendarContainer: View;
let focusView: WebContentsView;

// Focus space (Pomodoro). The timer runs here; the view only displays it.
function focusDone(finished: focusTimer.Phase, next: focusTimer.Phase) {
  if (!Notification.isSupported()) return;
  const mins = focusTimer.snapshot().settings[next];
  const n = new Notification({
    title: finished === 'focus' ? 'Focus session done' : 'Break’s over',
    body: finished === 'focus' ? `Nice work. Take a ${mins}-minute ${next === 'long' ? 'long ' : ''}break.` : `Ready for another ${mins}-minute focus session?`,
    silent: false,
  });
  n.on('click', () => {
    if (!shown || !win.isVisible()) showRail();
    goTo(SPACES.findIndex((sp) => sp.id === 'focus'));
  });
  n.show();
}
let calEvents: ncal.CalEvent[] = [];
let calCalendars: ncal.CalInfo[] = [];
let calError: { message: string; needsSignIn: boolean } | null = null;
let calLoadedDay = '';
let calBadge: string | 0 = 0;
const nudged = new Set<string>();
const NUDGE_MIN = 5;

const dayKey = () => new Date().toDateString();
const calOn = (key: string) => cfg.calendarsOn[key] ?? calCalendars.find((c) => c.key === key)?.defaultOn ?? true;
const visibleEvents = () => calEvents.filter((e) => calOn(e.calendar));

async function refreshCalendar() {
  if (!ncal.isConnected()) {
    calEvents = [];
    calCalendars = [];
    calError = null;
  } else {
    try {
      const r = await ncal.todayEvents();
      calEvents = r.events;
      calCalendars = r.calendars;
      calError = null;
      calLoadedDay = dayKey();
    } catch (err) {
      const c = err instanceof ncal.CalError ? err : null;
      calError = { message: (err as Error).message, needsSignIn: c?.needsSignIn ?? false };
    }
  }
  updateCalBadge();
  calendar?.webContents.send('rail:cal', calSnapshot());
}

function calSnapshot() {
  return {
    connected: ncal.isConnected(),
    events: visibleEvents(),
    calendars: calCalendars.map((c) => ({ ...c, on: calOn(c.key) })),
    error: calError,
  };
}

const countsForNudge = (e: ncal.CalEvent) => !e.allDay && e.response !== 'declined';

// "12m" when the next meeting is within the hour, "now" while one is on.
function updateCalBadge() {
  const now = Date.now();
  let next: string | 0 = 0;
  for (const e of visibleEvents()) {
    if (!countsForNudge(e)) continue;
    if (e.start > now && e.start - now <= 60 * 60 * 1000) {
      next = `${Math.max(1, Math.ceil((e.start - now) / 60000))}m`;
      break;
    }
  }
  if (next !== calBadge) {
    calBadge = next;
    broadcast();
  }
}

function nudge(e: ncal.CalEvent, startingNow: boolean) {
  const time = new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const n = new Notification({
    title: startingNow ? `Now: ${e.title}` : `In ${NUDGE_MIN} min: ${e.title}`,
    body: e.joinUrl ? `${time} · Click to join` : time,
  });
  n.on('click', () => {
    if (e.joinUrl) void shell.openExternal(e.joinUrl);
    else {
      if (!shown || !win.isVisible()) showRail();
      goTo(SPACES.findIndex((sp) => sp.id === 'calendar'));
    }
  });
  n.show();
}

// Every 20s: nudge 5 min before (and at the start of meetings with a link),
// keep the dot countdown fresh, roll over at midnight.
function calendarTick() {
  if (calLoadedDay && calLoadedDay !== dayKey()) void refreshCalendar();
  const now = Date.now();
  for (const e of visibleEvents()) {
    if (!countsForNudge(e)) continue;
    const soon = `${e.id}@${e.start}:soon`;
    const start = `${e.id}@${e.start}:start`;
    if (!nudged.has(soon) && e.start - now <= NUDGE_MIN * 60000 && e.start - now > 60000) {
      nudged.add(soon);
      nudge(e, false);
    }
    if (!nudged.has(start) && e.joinUrl && now >= e.start && now - e.start < 60000) {
      nudged.add(start);
      nudge(e, true);
    }
  }
  updateCalBadge();
}

type CalReq =
  | { op: 'get' }
  | { op: 'refresh' }
  | { op: 'connect' }
  | { op: 'disconnect' }
  | { op: 'toggle'; key: string }
  | { op: 'open'; url: string }
  | { op: 'move'; id: string; title: string; start: number; end: number }
  | { op: 'edit'; id: string; title: string; start: number; end: number }
  | { op: 'add'; calendar: string; title: string; start: number; end: number }
  | { op: 'notes'; id: string; transcribe?: boolean; join?: boolean }
  | { op: 'rsvp'; id: string; title: string; response: 'accepted' | 'declined' | 'tentative' };

// After a meeting note loads in the Notion pane, start Notion's own browser
// transcription (the "Start in browser" choice under its transcription
// button), the same as clicking it by hand. Only runs when the user pressed
// Transcribe in Rail.
const START_TRANSCRIPTION = `new Promise((done) => {
  const t0 = Date.now();
  const step = () => {
    if (Date.now() - t0 > 15000) return done('timeout');
    const item = [...document.querySelectorAll('.notion-overlay-container [role=menuitem], .notion-overlay-container [role=option], .notion-overlay-container [role=button]')]
      .find((x) => /^Start in browser/.test(x.textContent.trim()));
    if (item) { item.click(); return done('started'); }
    const more = document.querySelector('[role=button][aria-label^="More transcri"]');
    if (more && more.getAttribute('aria-expanded') !== 'true') more.click();
    setTimeout(step, 400);
  };
  step();
})`;

// Notion files a calendar meeting note as a block inside a page of the same
// name (the database row, with the user's properties). Notion's API returns
// the block's own page; when its parent in the top bar is that same-named page,
// open the parent instead, where the user takes notes.
const FIND_NOTE_PARENT = `new Promise((done) => {
  const t0 = Date.now();
  const norm = (t) => (t || '').replace(/\\s+/g, ' ').trim().slice(0, 24).toLowerCase();
  const step = () => {
    if (Date.now() - t0 > 8000) return done(null);
    const h1 = document.querySelector('.notion-frame h1, .notion-frame [placeholder="New page"], .notion-frame .notion-page-block');
    const here = location.pathname.match(/[0-9a-f]{32}/)?.[0];
    const link = [...document.querySelectorAll('.notion-topbar a[href*="/p/"], header a[href*="/p/"]')].pop();
    if (h1 && link) {
      const id = link.getAttribute('href').match(/[0-9a-f]{32}/)?.[0];
      return done(id && id !== here && norm(link.textContent) === norm(h1.textContent) ? link.href : null);
    }
    setTimeout(step, 300);
  };
  step();
})`;

async function openNoteParent() {
  const wc = notion.webContents;
  if (wc.isLoading()) await new Promise<void>((r) => wc.once('did-finish-load', () => r()));
  const parent = await wc.executeJavaScript(FIND_NOTE_PARENT).catch(() => null);
  if (typeof parent === 'string' && /^https:\/\/([a-z]+\.)?notion\.(so|com)\//.test(parent)) await wc.loadURL(parent).catch(() => {});
}

function startNoteTranscription() {
  const wc = notion.webContents;
  const run = () => void wc.executeJavaScript(START_TRANSCRIPTION).catch(() => {});
  if (wc.isLoading()) wc.once('did-finish-load', run);
  else run();
}

async function handleCal(req: CalReq): Promise<unknown> {
  switch (req.op) {
    case 'get':
      if (ncal.isConnected() && calLoadedDay !== dayKey()) await refreshCalendar();
      return calSnapshot();
    case 'refresh':
      await refreshCalendar();
      return calSnapshot();
    case 'connect':
      await ncal.connect();
      app.focus({ steal: true });
      await refreshCalendar();
      return calSnapshot();
    case 'disconnect':
      ncal.disconnect();
      await refreshCalendar();
      return calSnapshot();
    case 'toggle':
      cfg.calendarsOn = { ...cfg.calendarsOn, [req.key]: !calOn(req.key) };
      saveConfig(cfg);
      updateCalBadge();
      return calSnapshot();
    case 'open':
      if (/^https:\/\//.test(req.url)) await shell.openExternal(req.url);
      return calSnapshot();
    case 'move': {
      // Show the new time right away; the refresh confirms it.
      const e = calEvents.find((x) => x.id === req.id);
      if (e) { e.start = req.start; e.end = req.end; }
      calendar.webContents.send('rail:cal', calSnapshot());
      try {
        await ncal.moveEvent(req.id, req.title, req.start, req.end);
      } finally {
        await refreshCalendar();
      }
      return calSnapshot();
    }
    case 'edit': {
      const e = calEvents.find((x) => x.id === req.id);
      if (!e) throw new Error('That event isn’t on today’s calendar any more.');
      const title = String(req.title ?? '').trim();
      const start = Number(req.start), end = Number(req.end);
      if (!isFinite(start) || !isFinite(end) || end <= start) throw new Error('The end has to be after the start.');
      const change: { title?: string; start?: number; end?: number } = {};
      if (title && title !== e.title) change.title = title;
      if (start !== e.start || end !== e.end) { change.start = start; change.end = end; }
      await ncal.editEvent(e.id, e.title, change);
      await refreshCalendar();
      return calSnapshot();
    }
    case 'add':
      await ncal.addEvent(req.calendar, req.title.trim() || 'New event', req.start, req.end);
      await refreshCalendar();
      return calSnapshot();
    case 'notes': {
      const ev = calEvents.find((x) => x.id === req.id);
      if (req.join && ev?.joinUrl) void shell.openExternal(ev.joinUrl);
      showNotionPage(await ncal.meetingNote(req.id));
      await openNoteParent();
      if (req.transcribe) startNoteTranscription();
      return calSnapshot();
    }
    case 'rsvp': {
      const ev = calEvents.find((x) => x.id === req.id);
      if (ev) ev.response = req.response;
      calendar.webContents.send('rail:cal', calSnapshot());
      try {
        await ncal.rsvp(req.id, req.title, req.response);
      } finally {
        await refreshCalendar();
      }
      return calSnapshot();
    }
  }
}

function createWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win = new BaseWindow({
    ...dockBounds(display),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    // A side panel: the first click should act, not just focus the window.
    acceptFirstMouse: true,
    backgroundColor: BG,
    show: false,
  });
  win.setAlwaysOnTop(cfg.alwaysOnTop, 'floating');

  strip = createShellView('strip');
  divider = createShellView('divider');
  meetings = createShellView('meetings');
  const claudeSpace = new View();
  claude = makeClaude();
  claudeSpace.addChildView(claude);
  const notionSpace = new View();
  notionSpace.addChildView(divider);
  notion = makeNotion();
  notionSpace.addChildView(notion);

  const meet = new View();
  meet.addChildView(meetings);

  slackContainer = new View();
  calendarContainer = new View();
  calendar = createShellView('calendar');
  calendarContainer.addChildView(calendar);

  const focusContainer = new View();
  focusView = createShellView('focus');
  focusContainer.addChildView(focusView);

  containers.push(claudeSpace, notionSpace, meet, slackContainer, calendarContainer, focusContainer);
  win.contentView.addChildView(claudeSpace);
  win.contentView.addChildView(notionSpace);
  win.contentView.addChildView(meet);
  win.contentView.addChildView(slackContainer);
  win.contentView.addChildView(calendarContainer);
  win.contentView.addChildView(focusContainer);
  win.contentView.addChildView(strip);

  active = Math.min(cfg.activeSpace, SPACES.length - 1);
  if (SPACES[active].id === 'slack') ensureSlack();
  layout();
  win.on('resize', layout);
  win.show();
  focusActive();
}

async function runArcImport() {
  if (!arcInstalled()) {
    await dialog.showMessageBox({ type: 'info', message: 'Arc doesn\u2019t seem to be installed.' });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Import', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Import your Claude, Notion and Slack logins from Arc?',
    detail:
      'Rail copies only the claude.ai, Notion and Slack login cookies from Arc into its own panes. ' +
      'macOS will ask to let Rail use \u201cArc Safe Storage\u201d in your Keychain: click Allow. ' +
      'If you later log out in Arc or a login expires, run this again.',
  });
  if (response !== 0) return;

  try {
    const [c, n, sl] = await importFromArc([
      { session: session.fromPartition('persist:claude'), hosts: CLAUDE_HOSTS },
      { session: session.fromPartition('persist:notion'), hosts: NOTION_HOSTS },
      { session: session.fromPartition('persist:slack'), hosts: ['slack.com'] },
    ]);
    claude.webContents.loadURL(CLAUDE_URL);
    notion.webContents.loadURL(cfg.notionLastUrl ?? NOTION_URL);
    slack?.webContents.loadURL(SLACK_URL);
    const line = (name: string, k: number) => `${name}: ${k ? `${k} cookies` : 'no login found in Arc'}`;
    await dialog.showMessageBox({
      type: c && n && sl ? 'info' : 'warning',
      message: c || n || sl ? 'Logins imported' : 'Nothing to import',
      detail: [line('Claude', c), line('Notion', n), line('Slack', sl)].join('\n'),
    });
  } catch (err) {
    const msg = (err as Error).message;
    await dialog.showMessageBox({
      type: 'error',
      message: 'Couldn\u2019t import from Arc',
      detail: /SecKeychain|could not be found|user canceled|exit code/i.test(msg)
        ? 'Rail wasn\u2019t allowed to read Arc\u2019s Keychain entry. Try again and click Allow.'
        : msg,
    });
  }
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Rail',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Import Logins from Arc\u2026', click: () => void runArcImport() },
          {
            label: 'Open Notion Links in Rail',
            type: 'checkbox',
            enabled: app.isPackaged,
            checked: app.isPackaged && app.isDefaultProtocolClient('notion'),
            click: (item) => {
              if (item.checked) app.setAsDefaultProtocolClient('notion');
              else app.removeAsDefaultProtocolClient('notion');
            },
          },
          {
            label: 'Open at Login',
            type: 'checkbox',
            enabled: app.isPackaged,
            checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
            click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Fireflies (Space 2)
// ---------------------------------------------------------------------------

type FFReq =
  | { op: 'status' }
  | { op: 'setKey'; key: string }
  | { op: 'clearKey' }
  | { op: 'list'; search?: string }
  | { op: 'detail'; id: string }
  | { op: 'copy'; id: string; what: 'transcript' | 'link' | 'summary' }
  | { op: 'download'; id: string; format: 'md' | 'txt' }
  | { op: 'claude'; id: string }
  | { op: 'audio'; id: string }
  | { op: 'menu'; id: string }
  | { op: 'active' }
  | { op: 'openUrl'; url: string }
  | { op: 'live'; id: string }
  | { op: 'liveCopy'; id: string; title: string }
  | { op: 'liveClaude'; id: string; title: string };

function ffKey() {
  const key = getSecret('fireflies');
  if (!key) throw new ff.FirefliesError('No Fireflies API key yet.', true);
  return key;
}

async function handleFF(req: FFReq): Promise<unknown> {
  switch (req.op) {
    case 'status':
      return { hasKey: !!getSecret('fireflies') };
    case 'setKey': {
      const key = req.key.trim();
      await ff.validateKey(key);
      setSecret('fireflies', key);
      ff.clearCache();
      return { hasKey: true };
    }
    case 'clearKey':
      setSecret('fireflies', null);
      ff.clearCache();
      return { hasKey: false };
    case 'list':
      return ff.listMeetings(ffKey(), req.search);
    case 'detail':
      return ff.getMeeting(ffKey(), req.id);
    case 'openUrl':
      if (/^https:\/\//.test(req.url)) shell.openExternal(req.url);
      return { done: 'opened' };
    case 'active':
      return ff.activeMeetings(ffKey());
    case 'live':
      return { sentences: await ff.liveTranscript(ffKey(), req.id) };
    case 'liveCopy':
    case 'liveClaude': {
      const sentences = await ff.liveTranscript(ffKey(), req.id);
      if (!sentences?.length) throw new Error('Nothing transcribed yet.');
      if (req.op === 'liveCopy') {
        clipboard.writeText(ff.liveText(req.title, sentences));
        return { done: 'copied' };
      }
      return { done: await sendToClaude(ff.liveClaudePrompt(req.title, sentences)) };
    }
    case 'audio':
      return { url: await ff.getAudioUrl(ffKey(), req.id) };
    case 'menu': {
      // Native dropdown of the less-used actions; runs the pick and returns its result.
      const pick = await new Promise<string | null>((resolve) => {
        const item = (label: string, id: string) => ({ label, click: () => resolve(id) });
        Menu.buildFromTemplate([
          item('Copy transcript', 'copy:transcript'),
          item('Copy summary', 'copy:summary'),
          item('Copy link', 'copy:link'),
          { type: 'separator' },
          item('Download .md', 'download:md'),
          item('Download .txt', 'download:txt'),
          { type: 'separator' },
          item('Open in Fireflies', 'open'),
        ]).popup({ window: win, callback: () => setTimeout(() => resolve(null), 100) });
      });
      if (!pick) return { done: null };
      const [verb, arg] = pick.split(':');
      if (verb === 'copy') return { ...(await handleFF({ op: 'copy', id: req.id, what: arg as 'transcript' })) as object, what: arg };
      if (verb === 'download') return { ...(await handleFF({ op: 'download', id: req.id, format: arg as 'md' })) as object, what: arg };
      const m = await ff.getMeeting(ffKey(), req.id);
      shell.openExternal(m.transcript_url);
      return { done: 'opened' };
    }
    case 'copy': {
      const m = await ff.getMeeting(ffKey(), req.id);
      clipboard.writeText(
        req.what === 'link' ? m.transcript_url : req.what === 'summary' ? ff.summaryMarkdown(m) : ff.transcriptText(m),
      );
      return { done: 'copied' };
    }
    case 'download': {
      const m = await ff.getMeeting(ffKey(), req.id);
      const file = ff.saveMeeting(m, req.format);
      shell.showItemInFolder(file);
      return { done: 'saved', file };
    }
    case 'claude': {
      const m = await ff.getMeeting(ffKey(), req.id);
      return { done: await sendToClaude(ff.claudePrompt(m)) };
    }
  }
}

// Copy, slide to Work, focus Claude's composer and paste. If the composer
// can't be found (claude.ai changed), the text is still on the clipboard.
async function sendToClaude(text: string): Promise<'pasted' | 'copied'> {
  clipboard.writeText(text);
  goTo(spaceIndex('claude'));
  await new Promise((r) => setTimeout(r, SLIDE_MS + 80));
  const wc = claude.webContents;
  wc.focus();
  const focused = await wc
    .executeJavaScript(`(() => {
      const el = document.querySelector('.ProseMirror[contenteditable="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    })()`)
    .catch(() => false);
  if (!focused) return 'copied';
  wc.paste();
  return 'pasted';
}

function allowedPermissions(ses: Electron.Session, extra: string[] = []) {
  // Microphone for Claude voice and Slack huddles; clipboard for copy buttons.
  // Nothing else: no site gets notifications.
  const ok = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', ...extra]);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ok.has(permission)));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showRail());

  app.whenReady().then(() => {
    cfg = loadConfig();

    allowedPermissions(session.fromPartition('persist:claude'));
    allowedPermissions(session.fromPartition('persist:notion'));
    allowedPermissions(session.fromPartition('persist:slack')); // no notifications: Slack stays silent in Rail
    session.fromPartition('persist:slack').setPermissionCheckHandler((_wc, permission) => permission !== 'notifications');

    // Chess puzzles for the Focus space, from Lichess's public puzzle API
    // (no account; nothing is sent but the difficulty).
    ipcMain.handle('puzzle', async (e, difficulty: string) => {
      if (!shellIds.has(e.sender.id)) return { ok: false, error: 'Not allowed' };
      const d = ['easiest', 'easier', 'normal', 'harder', 'hardest'].includes(difficulty) ? difficulty : 'normal';
      try {
        const res = await fetch(`https://lichess.org/api/puzzle/next?difficulty=${d}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return { ok: false, error: res.status === 429 ? 'Lichess asked to slow down. Try again in a minute.' : `Lichess error (${res.status}).` };
        const j = await res.json();
        return { ok: true, data: { id: j.puzzle.id, fen: j.puzzle.fen, solution: j.puzzle.solution, rating: j.puzzle.rating, themes: j.puzzle.themes ?? [], lastMove: j.puzzle.lastMove ?? null } };
      } catch {
        return { ok: false, error: 'Can’t reach Lichess. Check your connection.' };
      }
    });
    ipcMain.handle('focus', (e, req: focusTimer.FocusReq) => {
      if (!shellIds.has(e.sender.id)) return null;
      return focusTimer.handle(req);
    });
    ipcMain.handle('cal', async (e, req: CalReq) => {
      if (!shellIds.has(e.sender.id)) return { ok: false, error: 'Not allowed' };
      try {
        return { ok: true, data: await handleCal(req) };
      } catch (err) {
        const c = err instanceof ncal.CalError ? err : null;
        // Debug builds only (opt-in port): include Notion's raw reply for a failed note lookup.
        const detail = process.env.RAIL_DEBUG_PORT && req.op === 'notes' ? ncal.lastNoteReply.slice(0, 4000) : undefined;
        return { ok: false, error: (err as Error).message, needsSignIn: c?.needsSignIn ?? false, detail };
      }
    });

    ipcMain.on('rail:cmd', (e, cmd: Cmd) => {
      if (!shellIds.has(e.sender.id)) return; // only Rail's own UI may send commands
      handleCmd(cmd);
    });
    ipcMain.handle('ff', async (e, req: FFReq) => {
      if (!shellIds.has(e.sender.id)) return { ok: false, error: 'Not allowed' };
      try {
        return { ok: true, data: await handleFF(req) };
      } catch (err) {
        const fe = err instanceof ff.FirefliesError ? err : null;
        return { ok: false, error: (err as Error).message, auth: fe?.auth ?? false };
      }
    });
    ipcMain.on('rail:swipe', (_e, dir: number) => {
      if (dir === 1 || dir === -1) goTo(active + dir);
    });

    // The installed app opens at login by default (once; the menu toggles it).
    if (app.isPackaged && !cfg.loginItemInitialized) {
      app.setLoginItemSettings({ openAtLogin: true });
      cfg.loginItemInitialized = true;
      saveConfig(cfg);
    }

    // Notion links (Notion Calendar's "Open meeting note", notion:// links
    // elsewhere) open in Rail's Notion pane. Set once; the Rail menu toggles it.
    if (app.isPackaged && !cfg.notionLinksInitialized) {
      app.setAsDefaultProtocolClient('notion');
      cfg.notionLinksInitialized = true;
      saveConfig(cfg);
    }

    focusTimer.init((snap) => focusView?.webContents.send('rail:focus', snap), focusDone);
    buildMenu();
    createWindow();
    ready = true;
    void refreshCalendar();
    setInterval(() => void refreshCalendar(), 5 * 60 * 1000);
    setInterval(calendarTick, 20 * 1000);
    powerMonitor.on('resume', () => { void refreshCalendar(); focusTimer.resume(); });
    if (pendingNotionLink) {
      const link = pendingNotionLink;
      pendingNotionLink = null;
      setTimeout(() => openNotionLink(link), 300);
    }

    screen.on('display-added', redock);
    screen.on('display-removed', redock);
    screen.on('display-metrics-changed', redock);

    if (!globalShortcut.register(HOTKEY, () => (shown && win.isVisible() ? hideRail() : showRail()))) {
      console.warn(`[rail] could not register ${HOTKEY}`);
    }

    app.on('activate', () => { if (!shown) showRail(); });
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (cfg) saveConfig(cfg, true);
  });

  // Rail lives until ⌘Q; closing a sign-in popup must not quit it.
  app.on('window-all-closed', () => {});
}
