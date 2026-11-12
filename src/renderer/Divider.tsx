import { send, useRailState } from './rail';
import { Back, Caret, External, Forward, Reload } from './icons';

// The Notion space's header: back/forward, recent pages, reload, open in browser.
export function Divider() {
  const s = useRailState();
  const nav = s?.notion;

  return (
    <div className="divider header">
      <button className="icon" disabled={!nav?.canBack} title="Back" onClick={() => send({ type: 'pane', pane: 'notion', action: 'back' })}><Back /></button>
      <button className="icon" disabled={!nav?.canForward} title="Forward" onClick={() => send({ type: 'pane', pane: 'notion', action: 'forward' })}><Forward /></button>
      <button className="crumb" title="Recent pages" onClick={() => send({ type: 'notion-trail' })}>
        <span className="crumb-text">{nav?.title ?? 'Notion'}</span>
        <Caret />
      </button>
      <div className="spacer" />
      <button className="icon" title="Reload" onClick={() => send({ type: 'pane', pane: 'notion', action: 'reload' })}><Reload /></button>
      <button className="icon" title="Open in browser" onClick={() => send({ type: 'pane', pane: 'notion', action: 'external' })}><External /></button>
    </div>
  );
}
