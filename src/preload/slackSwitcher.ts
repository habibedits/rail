// Slack quick switcher (Shift+Space while not typing in Slack). An Arc-style
// card over the Slack pane: your three most recent conversations with unread
// counts, a quick reply line for the selected one, search over people and
// channels, and one-tap Mentions / Unreads / Threads / New message.
//
// Data comes from Slack's own web API, called from the page with the page's
// own session, exactly as the Slack client does. Opening a conversation is
// done by Rail's main process through Slack's ⌘K switcher (real keypresses),
// so Slack never reloads.

export type SlackAction = 'activity' | 'unreads' | 'threads' | 'compose';
export interface SwitcherBridge {
  jump: (query: string, id: string) => Promise<boolean>;
  action: (a: SlackAction) => void;
  onOpened: (kind: 'chat' | 'list') => void;
}

interface Convo {
  id: string;          // channel id (D…, C…, G…)
  jumpId: string;      // id Slack's ⌘K result carries (user id for DMs)
  query: string;       // what to type into ⌘K
  name: string;
  kind: 'dm' | 'group' | 'channel';
  avatar?: string;
  initials: string;
  unread: number;
  hasUnread: boolean;
  preview?: string;
  latest?: string;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.dim { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.36); display: flex; justify-content: center; align-items: flex-start; padding-top: 44px;
  font: 13px/1.35 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; animation: fade .12s ease-out; }
@keyframes fade { from { opacity: 0 } }
@keyframes pop { from { transform: translateY(-6px) scale(.985); opacity: 0 } }
.card { width: calc(100% - 20px); max-width: 520px; max-height: calc(100% - 64px); display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--fg); border-radius: 14px; border: 1px solid var(--line2);
  box-shadow: 0 18px 50px rgba(0,0,0,.28), 0 2px 8px rgba(0,0,0,.12); animation: pop .14s cubic-bezier(.2,.8,.2,1); }
.q { display: flex; align-items: center; gap: 9px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.q svg { flex: none; color: var(--mute); }
.q input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--fg); font: 15px/1.2 inherit; font-family: inherit; }
.q input::placeholder { color: var(--mute); }
.body { overflow-y: auto; padding-bottom: 4px; }
.sec { font-size: 11px; color: var(--mute); padding: 10px 14px 4px; letter-spacing: .01em; }
.row { display: flex; align-items: center; gap: 10px; padding: 7px 14px; cursor: pointer; }
.row.on { background: var(--sel); }
.av { width: 28px; height: 28px; border-radius: 8px; flex: none; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600;
  background: var(--chip); color: var(--fg2); overflow: hidden; }
.av img { width: 100%; height: 100%; object-fit: cover; }
.av.ch { font-size: 14px; font-weight: 500; }
.txt { min-width: 0; flex: 1; }
.nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nm.bold { font-weight: 650; }
.sub { font-size: 11.5px; color: var(--fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { flex: none; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 9px; background: #e01e5a; color: #fff; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg); }
.k { flex: none; font-size: 11px; color: var(--mute); border: 1px solid var(--line2); border-radius: 5px; padding: 0 5px; line-height: 16px; }
mark { background: rgba(255, 196, 0, .35); color: inherit; border-radius: 2px; }
.reply { margin: 2px 10px 6px 52px; display: flex; align-items: center; gap: 6px; border: 1px solid var(--line2); border-radius: 9px; padding: 0 4px 0 10px; background: var(--field); }
.reply:focus-within { border-color: #1d9bd1; box-shadow: 0 0 0 3px rgba(29,155,209,.18); }
.reply input { flex: 1; min-width: 0; height: 32px; border: 0; outline: 0; background: transparent; color: var(--fg); font: 13px inherit; font-family: inherit; }
.reply input::placeholder { color: var(--mute); }
.reply button { border: 0; border-radius: 6px; height: 24px; padding: 0 9px; font: 600 12px inherit; font-family: inherit; cursor: pointer; background: #007a5a; color: #fff; }
.reply button:disabled { background: var(--chip); color: var(--mute); cursor: default; }
.note { font-size: 11.5px; color: var(--mute); padding: 0 14px 6px 52px; }
.note.ok { color: #2bac76; } .note.err { color: #e01e5a; }
.chips { display: flex; gap: 6px; padding: 6px 14px 12px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 5px 10px; border-radius: 999px; background: var(--chip); color: var(--fg2); cursor: pointer; border: 0; font-family: inherit; }
.chip:hover { color: var(--fg); background: var(--sel); }
.foot { display: flex; gap: 12px; padding: 7px 14px; border-top: 1px solid var(--line); font-size: 11px; color: var(--mute); flex-wrap: wrap; }
.empty { padding: 14px; color: var(--mute); }
`;

const LIGHT = '--bg:#fff;--fg:#1d1c1d;--fg2:#616061;--mute:#8d8c8d;--line:rgba(29,28,29,.08);--line2:rgba(29,28,29,.16);--sel:rgba(29,155,209,.12);--chip:rgba(29,28,29,.06);--field:#fff;';
const DARK = '--bg:#222529;--fg:#e8e8e8;--fg2:#ababad;--mute:#868686;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.16);--sel:rgba(29,155,209,.22);--chip:rgba(255,255,255,.08);--field:#1a1d21;';

const ICON = {
  search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="4.6"/><path d="m10.5 10.5 3.2 3.2"/></svg>',
  at: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="2.6"/><path d="M10.6 8v1.1a1.9 1.9 0 0 0 3.8 0V8a6.4 6.4 0 1 0-2.6 5.2"/></svg>',
  unread: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>',
  threads: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h8v5.5h-4l-2.5 2v-2h-1.5z"/><path d="M12.5 6.5h1v5.5h-1.5v2l-2.5-2h-2.5"/></svg>',
  compose: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5 13.5 5 6 12.5H3.5V10z"/></svg>',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const initialsOf = (s: string) => s.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

// Slack message text → a plain one-line preview.
function plain(text: string, names: Map<string, string>) {
  return text
    .replace(/<@([UW][A-Z0-9]+)(\|[^>]+)?>/g, (_m, id) => '@' + (names.get(id) ?? 'someone'))
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function installSlackSwitcher(bridge: SwitcherBridge) {
  // ---- Slack web API (the page's own session) ----
  const team = () => {
    try {
      const cfg = JSON.parse(localStorage.getItem('localConfig_v2') || '{}');
      const id = location.pathname.split('/')[2];
      const teams = cfg.teams || {};
      return (teams[id] || Object.values(teams)[0] || null) as { token: string; user_id: string; id: string } | null;
    } catch { return null; }
  };
  async function api(method: string, params: Record<string, string> = {}) {
    const t = team();
    if (!t) throw new Error('Slack isn’t signed in');
    const f = new FormData();
    f.append('token', t.token);
    for (const k in params) f.append(k, params[k]!);
    const r = await fetch(`/api/${method}`, { method: 'POST', body: f, credentials: 'include' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Slack error');
    return j;
  }

  interface User { id: string; name: string; avatar?: string; deleted?: boolean; bot?: boolean }
  const users = new Map<string, User>();
  const names = new Map<string, string>();
  const toUser = (u: any): User => {
    const name = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || 'Someone';
    const user = { id: u.id, name, avatar: u.profile?.image_72 || u.profile?.image_48, deleted: u.deleted, bot: u.is_bot || u.id === 'USLACKBOT' };
    users.set(u.id, user);
    names.set(u.id, name);
    return user;
  };
  async function user(id: string) {
    if (users.has(id)) return users.get(id)!;
    try { return toUser((await api('users.info', { user: id })).user); }
    catch { return { id, name: 'Someone' } as User; }
  }

  // Everyone and every channel you're in, for search. Loaded once, kept 10 minutes.
  let dir: { people: User[]; channels: { id: string; name: string; priv: boolean }[] } | null = null;
  let dirAt = 0;
  let dirLoading: Promise<void> | null = null;
  function loadDirectory() {
    if (dir && Date.now() - dirAt < 10 * 60_000) return Promise.resolve();
    if (dirLoading) return dirLoading;
    dirLoading = (async () => {
      const people: User[] = [];
      let cursor = '';
      for (let i = 0; i < 6; i++) {
        const j = await api('users.list', { limit: '400', ...(cursor ? { cursor } : {}) });
        for (const u of j.members || []) { const x = toUser(u); if (!x.deleted && !x.bot) people.push(x); }
        cursor = j.response_metadata?.next_cursor || '';
        if (!cursor) break;
      }
      // People you DM from other companies (Slack Connect) aren't in users.list:
      // add whoever you've DMed most recently.
      try {
        const ims: { id: string; user: string }[] = [];
        cursor = '';
        for (let i = 0; i < 4; i++) {
          const j = await api('users.conversations', { types: 'im', limit: '400', ...(cursor ? { cursor } : {}) });
          for (const c of j.channels || []) if (c.user) ims.push({ id: c.id, user: c.user });
          cursor = j.response_metadata?.next_cursor || '';
          if (!cursor) break;
        }
        const counts = await api('client.counts', { org_wide_aware: 'true' });
        const latest = new Map<string, string>((counts.ims || []).map((c: any) => [c.id, c.latest || '']));
        ims.sort((a, b) => ((latest.get(b.id) || '') > (latest.get(a.id) || '') ? 1 : -1));
        const known = new Set(people.map((u) => u.id));
        const extra = await Promise.all(ims.slice(0, 60).filter((c) => !known.has(c.user)).map((c) => user(c.user)));
        for (const u of extra) if (!u.deleted && !u.bot && u.name !== 'Someone') people.push(u);
      } catch { /* search still covers your workspace */ }
      const channels: { id: string; name: string; priv: boolean }[] = [];
      cursor = '';
      for (let i = 0; i < 6; i++) {
        const j = await api('users.conversations', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '400', ...(cursor ? { cursor } : {}) });
        for (const c of j.channels || []) channels.push({ id: c.id, name: c.name, priv: !!c.is_private });
        cursor = j.response_metadata?.next_cursor || '';
        if (!cursor) break;
      }
      dir = { people, channels };
      dirAt = Date.now();
    })().finally(() => { dirLoading = null; });
    return dirLoading;
  }

  // The three most recent DMs and group DMs, with unread counts and the last message.
  async function loadRecent(): Promise<Convo[]> {
    const counts = await api('client.counts', { org_wide_aware: 'true' });
    const me = team()?.user_id;
    const list = [...(counts.ims || []).map((c: any) => ({ ...c, dm: true })), ...(counts.mpims || []).map((c: any) => ({ ...c, dm: false }))]
      .filter((c: any) => c.latest)
      .sort((a: any, b: any) => (b.latest > a.latest ? 1 : -1))
      .slice(0, 3);
    return Promise.all(list.map(async (c: any): Promise<Convo> => {
      const [info, hist] = await Promise.all([
        api('conversations.info', { channel: c.id }).catch(() => null),
        api('conversations.history', { channel: c.id, limit: '1' }).catch(() => null),
      ]);
      const last = hist?.messages?.[0];
      let preview = '';
      if (last) {
        const who = last.user === me ? 'You' : last.user ? (await user(last.user)).name.split(' ')[0] : '';
        const body = plain(last.text || (last.files?.length ? '📎 a file' : ''), names);
        preview = who && !c.dm ? `${who}: ${body}` : who === 'You' ? `You: ${body}` : body;
      }
      const unread = c.mention_count || 0;
      if (c.dm) {
        const u = await user(info?.channel?.user || '');
        return { id: c.id, jumpId: u.id, query: u.name, name: u.name, kind: 'dm', avatar: u.avatar, initials: initialsOf(u.name), unread, hasUnread: !!c.has_unreads, preview, latest: c.latest };
      }
      const members: string[] = (await api('conversations.members', { channel: c.id, limit: '9' }).catch(() => ({ members: [] }))).members || [];
      const others = await Promise.all(members.filter((m) => m !== me).slice(0, 4).map(user));
      const name = others.map((u) => u.name.split(' ')[0]).join(', ') || 'Group';
      return { id: c.id, jumpId: c.id, query: others[0]?.name || name, name, kind: 'group', avatar: others[0]?.avatar, initials: initialsOf(name), unread, hasUnread: !!c.has_unreads, preview, latest: c.latest };
    }));
  }

  // ---- UI ----
  let host: HTMLDivElement | null = null;
  let root: ShadowRoot | null = null;
  let open = false;
  let recent: Convo[] = [];
  let results: Convo[] = [];
  let sel = 0;
  let query = '';
  let replyTo: string | null = null;  // channel id of the conversation the reply line is for
  let note: { id: string; text: string; cls: string } | null = null;
  let loadErr = '';
  let loading = false;

  const dark = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--sk_primary_background') || getComputedStyle(document.body).getPropertyValue('--sk_primary_background');
    const pane = document.querySelector('.p-view_contents--primary, .p-client_workspace__layout');
    const css = v.trim() ? `rgb(${v})` : pane ? getComputedStyle(pane).backgroundColor : '';
    const nums = css.match(/[\d.]+/g)?.map(Number);
    if (!nums || nums.length < 3 || nums[3] === 0) return matchMedia('(prefers-color-scheme: dark)').matches;
    const bg = nums;
    return (bg[0]! * 299 + bg[1]! * 587 + bg[2]! * 114) / 1000 < 128;
  };

  const shown = () => (query ? results : recent);

  function search(q: string): Convo[] {
    if (!dir) return [];
    const n = q.toLowerCase().trim();
    if (!n) return [];
    const score = (s: string) => {
      const l = s.toLowerCase();
      if (l.startsWith(n)) return 0;
      if (l.split(/[\s\-_.]+/).some((w) => w.startsWith(n))) return 1;
      return l.includes(n) ? 2 : -1;
    };
    const people = dir.people
      .map((u) => ({ u, s: score(u.name) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.u.name.localeCompare(b.u.name))
      .slice(0, 5)
      .map(({ u }): Convo => ({ id: u.id, jumpId: u.id, query: u.name, name: u.name, kind: 'dm', avatar: u.avatar, initials: initialsOf(u.name), unread: 0, hasUnread: false, preview: 'Direct message' }));
    const chans = dir.channels
      .map((c) => ({ c, s: score(c.name) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name))
      .slice(0, 4)
      .map(({ c }): Convo => ({ id: c.id, jumpId: c.id, query: c.name, name: c.name, kind: 'channel', initials: c.priv ? '🔒' : '#', unread: 0, hasUnread: false }));
    return [...people, ...chans];
  }

  const hl = (s: string) => {
    if (!query) return esc(s);
    const i = s.toLowerCase().indexOf(query.toLowerCase().trim());
    if (i < 0) return esc(s);
    const n = query.trim().length;
    return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + n)) + '</mark>' + esc(s.slice(i + n));
  };

  function rowHTML(c: Convo, i: number) {
    const av = c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : esc(c.initials);
    const right = c.unread > 0 ? `<span class="badge">${c.unread > 99 ? '99+' : c.unread}</span>`
      : c.hasUnread ? '<span class="dot"></span>'
      : !query ? `<span class="k">${i + 1}</span>` : i === sel ? '<span class="k">↵</span>' : '';
    const sub = c.preview ? `<div class="sub">${esc(c.preview)}</div>` : '';
    return `<div class="row ${i === sel ? 'on' : ''}" data-i="${i}">
      <div class="av ${c.kind === 'channel' ? 'ch' : ''}">${av}</div>
      <div class="txt"><div class="nm ${c.unread || c.hasUnread ? 'bold' : ''}">${hl(c.name)}</div>${sub}</div>${right}</div>`;
  }

  function render(keepFocus = true) {
    if (!root) return;
    const active = root.activeElement as HTMLElement | null;
    const focusReply = active?.classList.contains('rin');
    const replyVal = (root.querySelector('.rin') as HTMLInputElement | null)?.value ?? '';
    const list = shown();
    if (sel >= list.length) sel = Math.max(0, list.length - 1);
    const cur = list[sel];
    let body = '';
    if (!query) {
      body += '<div class="sec">Recent</div>';
      if (loading && !recent.length) body += '<div class="empty">Loading…</div>';
      else if (loadErr && !recent.length) body += `<div class="empty">${esc(loadErr)}</div>`;
      else if (!recent.length) body += '<div class="empty">No recent conversations</div>';
    } else {
      if (!dir) body += '<div class="empty">Loading people and channels…</div>';
      else if (!results.length) body += '<div class="empty">No people or channels match</div>';
    }
    let lastKind = '';
    list.forEach((c, i) => {
      if (query) {
        const k = c.kind === 'channel' ? 'Channels' : 'People';
        if (k !== lastKind) { body += `<div class="sec">${k}</div>`; lastKind = k; }
      }
      body += rowHTML(c, i);
      if (i === sel) {
        const first = c.name.split(/[ ,]/)[0];
        body += `<div class="reply"><input class="rin" placeholder="Reply to ${esc(first)}…" value="${esc(replyTo === c.id ? replyVal : '')}"><button class="send" ${replyTo === c.id && replyVal.trim() ? '' : 'disabled'}>Send</button></div>`;
        if (note && note.id === c.id) body += `<div class="note ${note.cls}">${esc(note.text)}</div>`;
      }
    });
    if (query) {
      body += `<div class="sec">Messages</div><div class="row ${sel === list.length ? 'on' : ''}" data-i="search"><div class="av">${ICON.search}</div><div class="txt"><div class="nm">Search Slack for “${esc(query)}”</div></div><span class="k">⌘↵</span></div>`;
    } else {
      body += `<div class="sec">Quick actions</div><div class="chips">
        <button class="chip" data-a="activity">${ICON.at}Mentions</button>
        <button class="chip" data-a="unreads">${ICON.unread}Unreads</button>
        <button class="chip" data-a="threads">${ICON.threads}Threads</button>
        <button class="chip" data-a="compose">${ICON.compose}New message</button></div>`;
    }
    const card = root.querySelector('.body')!;
    card.innerHTML = body;
    (root.querySelector('.foot') as HTMLElement).innerHTML = query
      ? '<span>↑↓ move</span><span>↵ open</span><span>tab reply</span><span>⌘↵ search</span><span>esc close</span>'
      : '<span>↑↓ move</span><span>↵ open</span><span>1–3 jump</span><span>tab reply</span><span>esc close</span>';
    if (cur) replyTo = replyTo === cur.id ? replyTo : null;
    root.querySelector('.row.on')?.scrollIntoView({ block: 'nearest' });
    if (keepFocus && focusReply) {
      const rin = root.querySelector('.rin') as HTMLInputElement | null;
      if (rin) { rin.focus(); rin.setSelectionRange(rin.value.length, rin.value.length); }
    }
  }

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'rail-switcher';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="dim"><div class="card" role="dialog" aria-label="Quick switcher">
      <div class="q">${ICON.search}<input class="qin" placeholder="Jump to a person or channel…" spellcheck="false" autocomplete="off"></div>
      <div class="body"></div><div class="foot"></div></div></div>`;
    const dim = root.querySelector('.dim') as HTMLElement;
    dim.addEventListener('mousedown', (e) => { if (e.target === dim) close(); });
    const qin = root.querySelector('.qin') as HTMLInputElement;
    qin.addEventListener('input', () => {
      query = qin.value;
      sel = 0;
      note = null;
      results = search(query);
      render();
      if (query && !dir) void loadDirectory().then(() => { results = search(query); render(); }).catch(() => {});
    });
    const body = root.querySelector('.body') as HTMLElement;
    body.addEventListener('mousemove', (e) => {
      const r = (e.target as Element).closest('.row') as HTMLElement | null;
      if (!r || r.dataset.i === undefined) return;
      const i = r.dataset.i === 'search' ? shown().length : Number(r.dataset.i);
      if (i !== sel) { sel = i; render(); }
    });
    body.addEventListener('click', (e) => {
      const t = e.target as Element;
      const chip = t.closest('.chip') as HTMLElement | null;
      if (chip) { void doAction(chip.dataset.a as SlackAction); return; }
      if (t.closest('.send')) { void send(); return; }
      if (t.closest('.reply')) return;
      const r = t.closest('.row') as HTMLElement | null;
      if (!r) return;
      if (r.dataset.i === 'search') fullSearch();
      else openConvo(shown()[Number(r.dataset.i)]);
    });
    body.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList.contains('rin')) return;
      replyTo = shown()[sel]?.id ?? null;
      const btn = root!.querySelector('.send') as HTMLButtonElement | null;
      if (btn) btn.disabled = !t.value.trim();
    });
    for (const type of ['keyup', 'keypress', 'input', 'paste', 'copy', 'cut', 'mousedown', 'click']) host.addEventListener(type, (e) => e.stopPropagation());
    document.documentElement.appendChild(host);
  }

  function show() {
    mount();
    open = true;
    query = '';
    sel = 0;
    note = null;
    replyTo = null;
    host!.setAttribute('style', dark() ? DARK : LIGHT);
    host!.style.display = '';
    const qin = root!.querySelector('.qin') as HTMLInputElement;
    qin.value = '';
    render(false);
    qin.focus();
    loading = true;
    loadErr = '';
    loadRecent()
      .then((r) => { recent = r; })
      .catch((e) => { loadErr = e?.message === 'Slack isn’t signed in' ? 'Sign in to Slack first' : 'Couldn’t load recent chats'; })
      .finally(() => { loading = false; if (open) render(); });
    void loadDirectory().catch(() => {});
  }

  function close() {
    open = false;
    if (host) host.style.display = 'none';
  }

  function openConvo(c: Convo | undefined) {
    if (!c) return;
    close();
    bridge.onOpened('chat');
    void bridge.jump(c.query, c.jumpId);
  }

  function fullSearch() {
    const q = query.trim();
    close();
    bridge.onOpened('chat');
    void bridge.jump(q, '');
  }

  // Quick actions press Slack's own buttons (Activity tab, Home's Unreads and
  // Threads views, the compose button).
  const click = (sel: string) => { const el = document.querySelector(sel) as HTMLElement | null; el?.click(); return !!el; };
  async function doAction(a: SlackAction) {
    close();
    if (a === 'activity') { click('[data-qa=tab_rail_activity_button]'); bridge.onOpened('list'); return; }
    if (a === 'compose') { if (!click('[data-qa=composer_button]')) bridge.action('compose'); return; }
    const item = a === 'unreads' ? '[data-qa=channel_sidebar_punreads]' : '[data-qa=channel_sidebar_vall_threads]';
    if (!document.querySelector(item)) { click('[data-qa=tab_rail_home_button]'); await new Promise((r) => setTimeout(r, 400)); }
    if (!click(item)) bridge.action(a); // Unreads hidden from the sidebar: Slack's ⌘⇧A still opens it
    bridge.onOpened('chat');
  }

  async function send() {
    const list = shown();
    const c = list[sel];
    const rin = root?.querySelector('.rin') as HTMLInputElement | null;
    const text = rin?.value.trim();
    if (!c || !rin || !text) return;
    rin.disabled = true;
    try {
      let channel = c.id;
      if (c.kind === 'dm' && !channel.startsWith('D')) channel = (await api('conversations.open', { users: c.jumpId })).channel.id;
      await api('chat.postMessage', { channel, text });
      rin.value = '';
      replyTo = null;
      note = { id: c.id, text: `Sent to ${c.name.split(/[ ,]/)[0]}`, cls: 'ok' };
      const r = recent.find((x) => x.id === channel);
      if (r) { r.preview = `You: ${text}`; r.unread = 0; r.hasUnread = false; }
    } catch (e: any) {
      note = { id: c.id, text: `Couldn’t send: ${e?.message || 'Slack error'}`, cls: 'err' };
    }
    rin.disabled = false;
    render(false);
    (root?.querySelector('.rin') as HTMLInputElement | null)?.focus();
  }

  // Slack keeps its message box focused almost all the time, so Shift+Space
  // also works there while the box is empty. Once you've typed anything it's
  // a normal space again.
  const typing = (el: Element | null) => {
    if (!el) return false;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.length > 0;
    if ((el as HTMLElement).isContentEditable) return ((el as HTMLElement).innerText || '').trim().length > 0;
    return false;
  };

  // Keys. Added before Slack's own scripts, in the capture phase, so the card
  // gets its keys first and Slack never sees them.
  window.addEventListener('keydown', (e) => {
    const inCard = !!host && e.composedPath().includes(host);
    if (!open) {
      if (e.key === ' ' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(document.activeElement)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        show();
      }
      return;
    }
    if (!inCard) { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } return; }
    e.stopImmediatePropagation();
    const inReply = (e.composedPath()[0] as Element)?.classList?.contains('rin');
    const list = shown();
    const max = query ? list.length : list.length - 1;
    const move = (d: number) => { e.preventDefault(); sel = Math.max(0, Math.min(max, sel + d)); note = null; render(false); (root!.querySelector('.qin') as HTMLInputElement).focus(); };
    if (e.key === 'Escape') {
      e.preventDefault();
      if (inReply) { (root!.querySelector('.qin') as HTMLInputElement).focus(); return; }
      close();
    } else if (e.key === 'ArrowDown' && !inReply) move(1);
    else if (e.key === 'ArrowUp' && !inReply) move(-1);
    else if (e.key === 'Tab') {
      e.preventDefault();
      const rin = root!.querySelector('.rin') as HTMLInputElement | null;
      if (inReply || !rin) (root!.querySelector('.qin') as HTMLInputElement).focus();
      else rin.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (inReply) { void send(); return; }
      if (query && (e.metaKey || sel === list.length)) fullSearch();
      else openConvo(list[sel]);
    } else if (!query && !inReply && /^[1-3]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openConvo(recent[Number(e.key) - 1]);
    }
  }, true);
  // Slack must not react to (or steal focus over) anything happening in the card.
  for (const type of ['focusin', 'focusout']) {
    window.addEventListener(type, (e) => { if (open && host && e.composedPath().includes(host)) e.stopImmediatePropagation(); }, true);
  }
  window.addEventListener('focusin', (e) => {
    // Slack moving focus back to itself while the card is open: put it back.
    if (open && host && !e.composedPath().includes(host)) setTimeout(() => { if (open && !root?.activeElement) (root?.querySelector('.qin') as HTMLInputElement | null)?.focus(); }, 0);
  }, true);
}

// For the README images (docs/design): the card's real styles and icons.
export const SWITCHER_CSS = CSS;
export const SWITCHER_LIGHT = LIGHT;
export const SWITCHER_ICON = ICON;
