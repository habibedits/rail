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

export function installSlackCompact() {
  let mode: 'list' | 'chat' = 'chat';
  
  // Slack rewrites <html class>, so Rail's state lives in its own attribute,
  // re-applied if anything removes it.
  const want = () => (window.innerWidth <= NARROW ? `narrow ${mode}` : '');
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

  // Slack's boot can replace the whole document after the preload runs, so
  // (re)mount whenever our style or button has gone missing.
  const mount = () => {
    if (!document.body) return;
    watch();
    apply();
    if (document.getElementById('rail-slack-style') && document.getElementById('rail-slack-back')) return;
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
    apply();
  };

  // The back button reacts on pointer-down, in a window capture listener added
  // before Slack's own scripts, so Slack's click handling can't swallow it.
  window.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target as Element | null;
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

  window.addEventListener('resize', apply);
  document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('load', mount);
  setInterval(mount, 1000);
  mount();
}
