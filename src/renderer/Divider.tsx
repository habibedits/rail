import { send, useRailState } from './rail';
import { Back, Caret, Down, External, Forward, NewChat, Reload, Up } from './icons';

// The bottom toolbar of the web panes, like Safari's.
// Notion: back, forward, the page (its menu: recent pages, home, reload,
// open elsewhere), up to the parent page, down into a page inside this one.
export function Divider() {
  const s = useRailState();
  const nav = s?.notion;

  return (
    <div className="panebar">
      <div className="pb-glass">
        <button className="pb" disabled={!nav?.canBack} title="Back" aria-label="Back" onClick={() => send({ type: 'pane', pane: 'notion', action: 'back' })}><Back /></button>
        <button className="pb" disabled={!nav?.canForward} title="Forward" aria-label="Forward" onClick={() => send({ type: 'pane', pane: 'notion', action: 'forward' })}><Forward /></button>
        <button className="pb-page" title="Recent pages" onClick={() => send({ type: 'notion-trail' })}>
          <span className="pb-title">{nav?.title || 'Notion'}</span>
          <Caret />
        </button>
        <button className="pb" title="Up to the page this is in" aria-label="Up to the parent page" onClick={() => send({ type: 'notion-up' })}><Up /></button>
        <button className="pb" title="Go into a page inside this one" aria-label="Pages inside this one" onClick={() => send({ type: 'notion-down' })}><Down /></button>
      </div>
    </div>
  );
}

// Claude: back, reload, new chat, open in browser.
export function ClaudeBar() {
  return (
    <div className="panebar">
      <div className="pb-glass">
        <button className="pb" title="Back" aria-label="Back" onClick={() => send({ type: 'pane', pane: 'claude', action: 'back' })}><Back /></button>
        <button className="pb" title="Reload" aria-label="Reload" onClick={() => send({ type: 'pane', pane: 'claude', action: 'reload' })}><Reload /></button>
        <button className="pb-page" title="Start a new chat" onClick={() => send({ type: 'pane', pane: 'claude', action: 'new' })}>
          <NewChat /><span className="pb-title">New chat</span>
        </button>
        <button className="pb" title="Open in browser" aria-label="Open in browser" onClick={() => send({ type: 'pane', pane: 'claude', action: 'external' })}><External /></button>
      </div>
    </div>
  );
}
