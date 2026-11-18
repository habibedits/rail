// Slack in a narrow pane (PRD §6.4). Slack's web client wants ≥668px and lays the
// conversation list and the open chat side by side, which leaves the chat a few
// characters wide in Rail. Below 640px we show one at a time, like a phone:
//   list mode: Slack's left tab rail + the conversation list, full width
//   chat mode: just the open conversation (or its thread), with a "‹" back button
// Clicking a conversation switches to chat; the back button returns to the list.

const NARROW = 640;

const CSS = `
html[data-rail~="narrow"] .p-ia4_client { min-width: 0 !important; }
html[data-rail~="narrow"] .p-client_workspace__tabpanel { display: flex !important; }
html[data-rail~="narrow"] .p-client_workspace__tabpanel .p-view_contents { min-width: 0 !important; max-width: none !important; }
html[data-rail~="narrow"] .p-client_workspace__tabpanel .p-resizer { display: none !important; }

/* List mode */
html[data-rail~="list"] .p-view_contents--sidebar { flex: 1 1 auto !important; width: auto !important; }
html[data-rail~="list"] .p-view_contents--primary,
html[data-rail~="list"] .p-view_contents--secondary { display: none !important; }

/* Chat mode */
html[data-rail~="chat"] .p-client_workspace_wrapper { grid-template-columns: 0px minmax(0, 1fr) !important; }
html[data-rail~="chat"] .p-tab_rail, html[data-rail~="chat"] .p-control_strip { visibility: hidden !important; overflow: hidden !important; }
html[data-rail~="chat"] .p-view_contents--sidebar { display: none !important; }
html[data-rail~="chat"] .p-view_contents--primary { flex: 1 1 auto !important; width: auto !important; }
html[data-rail~="chat"] .p-client_workspace__tabpanel:has(.p-view_contents--secondary) .p-view_contents--primary { display: none !important; }
html[data-rail~="chat"] .p-view_contents--secondary { flex: 1 1 auto !important; width: auto !important; }

/* Slack's top bar is a window-drag area, which swallows real clicks on the
   back button. Rail's window can't be dragged anyway. */
html[data-rail~="narrow"] .p-ia4_top_nav, html[data-rail~="narrow"] .p-ia4_top_nav * { -webkit-app-region: no-drag !important; }

/* Top bar: no Slackbot AI, AI agents or Help buttons. */
html[data-rail~="narrow"] [data-qa="slackbot-ai-button"],
html[data-rail~="narrow"] [class*="sparkleWrapper"]:has([data-qa="slackbot-ai-button"]),
html[data-rail~="narrow"] [data-qa="ai-apps-menu-container"],
html[data-rail~="narrow"] [data-qa="top-nav-help-button"] { display: none !important; }

/* Hovering a message: no quick reactions or action buttons covering the text,
   just Slack's own ⋮ (More actions) at the right edge. Reacting (R) and
   replying (T) still work from the keyboard while a message is hovered. */
.c-message-actions--hover-actions > *:not(:has([data-qa="more_message_actions"])) { display: none !important; }
.c-message_actions__container .c-message-actions--hover-actions { padding: 1px !important; }

/* No tab rail on the left in list mode either: Rail's ⋯ button in the top bar
   opens its items (Home, DMs, Activity, Threads, Files…) as a menu. */
html[data-rail~="list"] .p-client_workspace_wrapper { grid-template-columns: 0px minmax(0, 1fr) !important; }
html[data-rail~="list"] .p-tab_rail, html[data-rail~="list"] .p-control_strip { visibility: hidden !important; overflow: hidden !important; }
html[data-rail~="chat"] .p-ia4_top_nav__left_container { margin-left: 36px !important; }
#rail-slack-more {
  -webkit-app-region: no-drag;
  display: none; position: fixed; z-index: 9999; left: 8px; top: 7px; width: 30px; height: 26px; border-radius: 13px; border: 0; padding: 0;
  cursor: pointer; align-items: center; justify-content: center;
  color: rgba(var(--sk_primary_foreground, 29,28,29), 1);
  background: rgba(var(--sk_primary_foreground, 29,28,29), 0.08);
}
#rail-slack-more:hover, #rail-slack-more[aria-expanded="true"] { background: rgba(var(--sk_primary_foreground, 29,28,29), 0.16); }
html[data-rail~="narrow"] #rail-slack-more { display: inline-flex; }
html[data-rail~="chat"] #rail-slack-more { left: 84px; }
#rail-slack-menu {
  position: fixed; z-index: 10000; top: 38px; left: 8px; min-width: 196px; padding: 6px; border-radius: 12px;
  background: var(--dt_color-base-pry, #fff); color: var(--dt_color-content-pry, #1d1c1d);
  border: 1px solid rgba(var(--sk_primary_foreground, 29,28,29), 0.13); box-shadow: 0 12px 34px rgba(0,0,0,.28);
  font: 14px/1.2 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}
#rail-slack-menu[hidden] { display: none; }
#rail-slack-menu button {
  display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; color: inherit; font: inherit;
  padding: 7px 10px; border-radius: 7px; cursor: pointer; text-align: left;
}
#rail-slack-menu button:hover { background: #1264a3; color: #fff; }
#rail-slack-menu button.on { font-weight: 700; }
#rail-slack-menu svg { flex: none; opacity: .85; }
#rail-slack-menu hr { border: 0; height: 1px; margin: 5px 4px; background: rgba(var(--sk_primary_foreground, 29,28,29), 0.13); }

/* Pop-ups wider than the pane (the emoji picker is 361px) are scaled down to
   fit by fitPopovers(), and the page never scrolls sideways. */
html[data-rail~="narrow"], html[data-rail~="narrow"] body { overflow-x: clip !important; }

/* Message times: Slack's compact layout keeps a 56px time column on the left
   of every message, about a fifth of the pane. Drop the column so messages use
   the full width: the sender's name gets its own line with a small time right
   after it (placed by placeTimes() below), and a follow-up message's time shows
   at the right only while hovered. */
html[data-rail~="narrow"] .c-message_kit__gutter--compact:has(> .c-message_kit__gutter__left :is(.p-message_pane_message__compact_timestamp, .p-unreads_view_compact_timestamp)) {
  position: relative; padding-left: 12px !important; padding-right: 12px !important;
}
html[data-rail~="narrow"] .c-message_kit__gutter--compact > .c-message_kit__gutter__left:has(:is(.p-message_pane_message__compact_timestamp, .p-unreads_view_compact_timestamp)) {
  position: absolute; top: 1px; right: 12px; margin: 0; z-index: 1;
}
html[data-rail~="narrow"] :is(.p-message_pane_message__compact_timestamp, .p-unreads_view_compact_timestamp) { width: auto !important; margin: 0 !important; text-align: right; }
html[data-rail~="narrow"] :is(.p-message_pane_message__compact_timestamp, .p-unreads_view_compact_timestamp) .c-timestamp { font-size: 11px; line-height: 18px; }
html[data-rail~="narrow"] :is(.p-message_pane_message__compact_timestamp--adjacent, .p-unreads_view_compact_timestamp--adjacent) {
  padding: 0 6px; border-radius: 6px; background: var(--dt_color-base-pry, rgba(var(--sk_primary_background, 255,255,255), 1));
}
html[data-rail~="narrow"] .c-message_kit__gutter--compact:has(> .c-message_kit__gutter__left :is(.p-message_pane_message__compact_timestamp, .p-unreads_view_compact_timestamp)) .c-message_kit__indent { padding-left: 0 !important; }
html[data-rail~="narrow"] .c-message_kit__gutter--compact:has(> .c-message_kit__gutter__left :is(.p-message_pane_message__compact_timestamp, .p-unreads_view_compact_timestamp)) .c-message__sender {
  display: block; margin-left: 0 !important; padding-right: 64px;
}
html[data-rail~="narrow"] .c-message_kit__gutter--compact:has(> .c-message_kit__gutter__left :is(.p-message_pane_message__compact_timestamp, .p-unreads_view_compact_timestamp)) .c-message__sender ~ .c-message_kit__blocks--inline { margin-left: -0.28em; }
/* Messages with no sender line (e.g. "A huddle happened"): time on hover only. */
html[data-rail~="narrow"] .c-message_kit__gutter--compact:not(:has(.c-message__sender)) > .c-message_kit__gutter__left { opacity: 0; }
html[data-rail~="narrow"] .c-message_kit__hover--hovered .c-message_kit__gutter--compact:not(:has(.c-message__sender)) > .c-message_kit__gutter__left { opacity: 1; }

/* Huddles and calls: Slack floats its call window (at least 455px wide) over
   the bottom-left corner, which in Rail spills off the pane and covers the
   messages. Dock it as a card across the bottom instead, and shrink the client
   above it by the card's height (--rail-huddle-h, measured live) so nothing
   is hidden underneath. Video and screen shares get a bigger card. */
html[data-rail~="narrow"] .p-huddle_workspace {
  left: 6px !important; right: 6px !important; bottom: 6px !important; top: auto !important;
  width: auto !important; height: auto !important; transform: none !important;
}
html[data-rail~="narrow"] .p-huddle_workspace .p-huddle_window {
  min-width: 0 !important; min-height: 0 !important; width: 100% !important; height: auto !important;
  max-height: 52vh !important; border-radius: 12px !important; overflow: hidden !important;
  box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 8px 28px rgba(0,0,0,.28) !important;
}
html[data-rail~="narrow"] .p-huddle_workspace .p-huddle_window:has(video, .p-huddle_screenshare_tile, .p-huddle_av_video_pane) {
  height: min(48vh, 420px) !important;
}
html[data-rail~="narrow"] .p-huddle_workspace .p-huddle_window_titlebar { app-region: no-drag !important; -webkit-app-region: no-drag !important; }
html[data-rail~="narrow"] .p-huddle_workspace .p-huddle_window_resize_button { display: none !important; }
html[data-rail~="narrow"] .p-huddle_workspace .p-huddle_window_content { min-width: 0 !important; }
html[data-rail~="huddle"] .p-client_workspace__layout { padding-bottom: calc(var(--rail-huddle-h, 0px) + 12px) !important; box-sizing: border-box !important; }

#rail-slack-back {
  -webkit-app-region: no-drag;
  display: none; position: fixed; z-index: 9999; left: 8px; top: 7px;
  height: 26px; padding: 0 10px 0 7px; border-radius: 13px; border: 0; cursor: pointer;
  align-items: center; gap: 3px; font: 600 13px/1 -apple-system, system-ui, sans-serif;
  color: rgba(var(--sk_primary_foreground, 29,28,29), 1);
  background: rgba(var(--sk_primary_foreground, 29,28,29), 0.08);
}
#rail-slack-back:hover { background: rgba(var(--sk_primary_foreground, 29,28,29), 0.14); }
html[data-rail~="chat"] #rail-slack-back { display: inline-flex; }
`;

export function installSlackCompact(): (m: 'list' | 'chat') => void {
  let mode: 'list' | 'chat' = 'chat';
  
  // Slack rewrites <html class>, so Rail's state lives in its own attribute,
  // re-applied if anything removes it.
  let huddleH = 0;
  const want = () => (window.innerWidth <= NARROW ? `narrow ${mode}${huddleH ? ' huddle' : ''}` : '');
  const apply = () => {
    const root = document.documentElement;
    if (root && root.getAttribute('data-rail') !== want()) root.setAttribute('data-rail', want());
  };
  let watched: Element | null = null;
  const watch = () => {
    if (watched === document.documentElement) return;
    watched = document.documentElement;
    new MutationObserver(apply).observe(watched, { attributes: true, attributeFilter: ['data-rail'] });
  };
  const set = (m: typeof mode) => {
    mode = m;
    apply();
  };

  // The ⋯ menu: Slack's tab rail items, plus Threads and New message.
  const ic = (d: string) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ITEMS: { id: string; label: string; icon: string; sel: string; mode: 'list' | 'chat'; viaHome?: boolean }[] = [
    { id: 'home', label: 'Home', icon: ic('<path d="M2.5 7.5 8 3l5.5 4.5V13h-11z"/>'), sel: '[data-qa=tab_rail_home_button]', mode: 'list' },
    { id: 'dms', label: 'DMs', icon: ic('<path d="M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z"/>'), sel: '[data-qa=tab_rail_dms_button]', mode: 'list' },
    { id: 'activity', label: 'Activity', icon: ic('<path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3zM6.5 13.5a1.5 1.5 0 0 0 3 0"/>'), sel: '[data-qa=tab_rail_activity_button]', mode: 'list' },
    { id: 'threads', label: 'Threads', icon: ic('<path d="M2.5 3.5h8v5.5h-4l-2.5 2v-2h-1.5z"/><path d="M12.5 6.5h1v5.5h-1.5v2l-2.5-2h-2.5"/>'), sel: '[data-qa=channel_sidebar_vall_threads]', mode: 'chat', viaHome: true },
    { id: 'files', label: 'Files', icon: ic('<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3"/>'), sel: '[data-qa=tab_rail_files_button]', mode: 'list' },
    { id: 'later', label: 'To-dos', icon: ic('<circle cx="8" cy="8" r="5.5"/><path d="m5.7 8.2 1.6 1.6 3-3.3"/>'), sel: '[data-qa=tab_rail_later_button]', mode: 'list' },
    { id: 'browse', label: 'More…', icon: ic('<circle cx="4" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12" cy="8" r=".8"/>'), sel: '[data-qa=tab_rail_browse_button]', mode: 'list' },
    { id: 'compose', label: 'New message', icon: ic('<path d="M11 2.5 13.5 5 6 12.5H3.5V10z"/>'), sel: '[data-qa=composer_button]', mode: 'chat' },
    { id: 'you', label: 'Profile and preferences', icon: ic('<circle cx="8" cy="6" r="2.5"/><path d="M3.5 13.5a4.5 4.5 0 0 1 9 0"/>'), sel: '[data-qa=user-button]', mode: 'list' },
  ];
  const menuEl = () => document.getElementById('rail-slack-menu') as HTMLDivElement | null;
  const closeMenu = () => {
    const m = menuEl();
    if (m) m.hidden = true;
    document.getElementById('rail-slack-more')?.setAttribute('aria-expanded', 'false');
  };
  const openMenu = () => {
    const m = menuEl();
    const btn = document.getElementById('rail-slack-more');
    if (!m || !btn) return;
    const on = (sel: string) => {
      const el = document.querySelector(sel);
      return !!el && (el.getAttribute('aria-selected') === 'true' || el.classList.contains('p-tab_rail__button--active') || !!el.closest('[aria-selected=true]'));
    };
    m.querySelectorAll<HTMLButtonElement>('button[data-id]').forEach((b) => {
      const it = ITEMS.find((x) => x.id === b.dataset.id)!;
      b.classList.toggle('on', it.mode === 'list' && on(it.sel));
    });
    m.style.left = `${btn.getBoundingClientRect().left}px`;
    m.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };
  const pick = async (id: string) => {
    closeMenu();
    const it = ITEMS.find((x) => x.id === id);
    if (!it) return;
    if (it.viaHome && !document.querySelector(it.sel)) {
      (document.querySelector('[data-qa=tab_rail_home_button]') as HTMLElement | null)?.click();
      await new Promise((r) => setTimeout(r, 400));
    }
    (document.querySelector(it.sel) as HTMLElement | null)?.click();
    set(it.mode);
  };
  const mountMore = () => {
    const more = document.createElement('button');
    more.id = 'rail-slack-more';
    more.title = 'Home, DMs, Activity, Threads…';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>';
    document.body.appendChild(more);
    const menu = document.createElement('div');
    menu.id = 'rail-slack-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menu.innerHTML = ITEMS.map((it, i) => (i === 7 ? '<hr>' : '') + `<button role="menuitem" data-id="${it.id}">${it.icon}<span>${it.label}</span></button>`).join('');
    document.body.appendChild(menu);
  };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuEl() && !menuEl()!.hidden) { e.stopImmediatePropagation(); closeMenu(); } }, true);

  // Slack's boot can replace the whole document after the preload runs, so
  // (re)mount whenever our style or button has gone missing.
  const mount = () => {
    if (!document.body) return;
    watch();
    apply();
    if (document.getElementById('rail-slack-style') && document.getElementById('rail-slack-back') && document.getElementById('rail-slack-more')) return;
    document.getElementById('rail-slack-more')?.remove();
    document.getElementById('rail-slack-menu')?.remove();
    document.getElementById('rail-slack-style')?.remove();
    document.getElementById('rail-slack-back')?.remove();
    const style = document.createElement('style');
    style.id = 'rail-slack-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    const back = document.createElement('button');
    back.id = 'rail-slack-back';
    back.title = 'Conversations';
    back.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>Chats';
    back.addEventListener('click', () => set('list'));
    document.body.appendChild(back);
    mountMore();
    apply();
  };

  // The back button reacts on pointer-down, in a window capture listener added
  // before Slack's own scripts, so Slack's click handling can't swallow it.
  window.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target as Element | null;
      if (el?.closest?.('#rail-slack-more')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (menuEl()?.hidden === false) closeMenu(); else openMenu();
        return;
      }
      const item = el?.closest?.('#rail-slack-menu button[data-id]') as HTMLElement | null;
      if (item) { e.preventDefault(); e.stopImmediatePropagation(); void pick(item.dataset.id!); return; }
      if (el?.closest?.('#rail-slack-menu')) { e.stopImmediatePropagation(); return; }
      if (menuEl()?.hidden === false) closeMenu();
      if (!el?.closest?.('#rail-slack-back')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      set('list');
    },
    true,
  );

  // Picking a conversation opens it; switching Slack tabs (Home, DMs, Activity…) shows the list.
  document.addEventListener(
    'click',
    (e) => {
      if (window.innerWidth > NARROW) return;
      const el = e.target as Element | null;
      if (!el?.closest) return;
      if (el.closest('.p-tab_rail')) return set('list');
      const side = el.closest('.p-view_contents--sidebar');
      if (!side) return;
      const item = el.closest('[role="treeitem"], [role="listitem"], [role="option"], [role="row"], a[href*="/client/"]');
      if (item && !el.closest('button[aria-haspopup], [role="button"][aria-haspopup]')) setTimeout(() => set('chat'), 0);
    },
    true,
  );

  // Measure the docked call card so the client above it can make room.
  let card: Element | null = null;
  const ro = new ResizeObserver(() => syncHuddle());
  const syncHuddle = () => {
    const h = card && card.isConnected && window.innerWidth <= NARROW ? Math.ceil(card.getBoundingClientRect().height) : 0;
    if (h === huddleH) return;
    huddleH = h;
    document.documentElement.style.setProperty('--rail-huddle-h', `${h}px`);
    apply();
  };
  const trackHuddle = () => {
    const el = document.querySelector('.p-huddle_workspace .p-huddle_window, .p-huddle_workspace .p-huddle_mini_panel');
    if (el !== card) {
      if (card) ro.unobserve(card);
      card = el;
      if (el) ro.observe(el);
    }
    syncHuddle();
  };
  setInterval(trackHuddle, 500);

  // Message times sit just after the sender's name. Slack renders the time in
  // its own column, so measure each name and move the time beside it.
  let timesQueued = 0;
  const placeTimes = () => {
    timesQueued = 0;
    if (window.innerWidth > NARROW) return;
    document.querySelectorAll<HTMLElement>('.c-message_kit__gutter--compact > .c-message_kit__gutter__left').forEach((left) => {
      const stamp = left.querySelector(':scope > .p-message_pane_message__compact_timestamp, :scope > .p-unreads_view_compact_timestamp');
      if (!stamp || /--adjacent/.test(stamp.className)) return;
      const gutter = left.parentElement!;
      const sender = gutter.querySelector<HTMLElement>('.c-message__sender');
      if (!sender) return;
      // The name plus anything after it (status emoji, APP or VIP badges).
      const range = document.createRange();
      range.selectNodeContents(sender);
      const right = Math.max(...[...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.right));
      if (!Number.isFinite(right)) return;
      const x = Math.round(right - gutter.getBoundingClientRect().left + 6);
      if (left.style.left !== `${x}px`) { left.style.left = `${x}px`; left.style.right = 'auto'; }
    });
  };
  const fitPopovers = () => {
    if (window.innerWidth > NARROW) return;
    const room = window.innerWidth - 12;
    document.querySelectorAll<HTMLElement>('.ReactModal__Content').forEach((el) => {
      if (!el.dataset.railW) {
        const w = el.getBoundingClientRect().width;
        if (!w) return;
        el.dataset.railW = String(w);
      }
      const w = Number(el.dataset.railW);
      if (w <= room) return;
      const z = room / w;
      el.style.setProperty('zoom', String(z));
      el.style.setProperty('left', `${6 / z}px`, 'important');
      const top = parseFloat(el.style.top);
      if (top && !el.dataset.railTop) { el.dataset.railTop = '1'; el.style.top = `${top / z}px`; }
    });
    for (const sc of [document.scrollingElement, document.body, document.querySelector('.p-client_container')]) if (sc && sc.scrollLeft) sc.scrollLeft = 0;
  };
  const queueTimes = () => { if (!timesQueued) timesQueued = requestAnimationFrame(() => { placeTimes(); fitPopovers(); }); };
  const watchTimes = () => {
    if (!document.body) return setTimeout(watchTimes, 200);
    new MutationObserver(queueTimes).observe(document.body, { childList: true, subtree: true });
    queueTimes();
  };
  watchTimes();
  setInterval(queueTimes, 1000); // Slack can replace <body> while booting
  window.addEventListener('resize', queueTimes);

  window.addEventListener('resize', apply);
  document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('load', mount);
  setInterval(mount, 1000);
  mount();
  return (m) => { if (window.innerWidth <= NARROW) set(m); };
}
