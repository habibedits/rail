import { send, useRailState } from './rail';
import { Back, External, Hide, Pin, Plus, Reload } from './icons';

// The 28px top strip: space dots, space name, Claude actions (Claude space), pin, hide.
export function Strip() {
  const s = useRailState();
  if (!s) return <div className="strip" />;
  const space = s.spaces[s.active];
  const work = space?.id === 'claude';

  return (
    <div className="strip">
      <div className="dots" role="tablist">
        {s.spaces.map((sp, i) => (
          <button
            key={sp.id}
            role="tab"
            aria-selected={i === s.active}
            aria-label={typeof sp.badge === 'string' && sp.badge !== 'dot' ? `${sp.name}, next meeting ${sp.badge}` : sp.badge ? `${sp.name}, unread` : sp.name}
            title={`${sp.name}  ⌃${i + 1}`}
            className={`dot ${i === s.active ? 'on' : ''}`}
            onClick={() => send({ type: 'goto', index: i })}
          >
            {sp.badge === 'dot' && <span className="badge dotonly" />}
            {typeof sp.badge === 'number' && sp.badge > 0 && (
              <span className="badge">{sp.badge > 9 ? '9+' : sp.badge}</span>
            )}
            {typeof sp.badge === 'string' && sp.badge !== 'dot' && (
              <span className={`badge time ${sp.badge === 'now' ? 'now' : ''}`}>{sp.badge}</span>
            )}
          </button>
        ))}
      </div>
      <span className="name">{space?.name}</span>

      <div className="spacer" />

      {work && (
        <div className="group">
          <button className="icon" title="Back" onClick={() => send({ type: 'pane', pane: 'claude', action: 'back' })}><Back /></button>
          <button className="icon" title="Reload" onClick={() => send({ type: 'pane', pane: 'claude', action: 'reload' })}><Reload /></button>
          <button className="icon" title="New chat" onClick={() => send({ type: 'pane', pane: 'claude', action: 'new' })}><Plus /></button>
          <button className="icon" title="Open in browser" onClick={() => send({ type: 'pane', pane: 'claude', action: 'external' })}><External /></button>
          <span className="sep" />
        </div>
      )}

      <button
        className={`icon ${s.pinned ? 'active' : ''}`}
        title={s.pinned ? 'Unpin (stop staying on top)' : 'Pin on top'}
        onClick={() => send({ type: 'pin' })}
      >
        <Pin on={s.pinned} />
      </button>
      <button className="icon" title="Hide  ⌃`" onClick={() => send({ type: 'hide' })}><Hide /></button>
    </div>
  );
}
