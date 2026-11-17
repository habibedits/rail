import { send, useRailState } from './rail';
import { Hide, Pin, SpaceIcon } from './icons';

// The top of the panel: a glass tab bar of every space (its symbol, with an
// unread count or a meeting countdown on it), then pin and hide.
export function Strip() {
  const s = useRailState();
  if (!s) return <div className="strip" />;

  return (
    <div className="strip">
      <div className="tabs" role="tablist">
        {s.spaces.map((sp, i) => {
          const time = typeof sp.badge === 'string' && sp.badge !== 'dot' ? sp.badge : null;
          return (
            <button
              key={sp.id}
              role="tab"
              aria-selected={i === s.active}
              aria-label={time ? `${sp.name}, next meeting ${time}` : sp.badge ? `${sp.name}, unread` : sp.name}
              title={`${sp.name}  ⌃${i + 1}`}
              className={`tab ${i === s.active ? 'on' : ''}`}
              onClick={() => send({ type: 'goto', index: i })}
            >
              <SpaceIcon id={sp.id} />
              {sp.badge === 'dot' && <span className="badge dotonly" />}
              {typeof sp.badge === 'number' && sp.badge > 0 && <span className="badge">{sp.badge > 9 ? '9+' : sp.badge}</span>}
              {time && <span className={`badge time ${time === 'now' ? 'now' : ''}`}>{time}</span>}
            </button>
          );
        })}
      </div>

      <div className="spacer" />
      <button
        className={`round ${s.pinned ? 'active' : ''}`}
        title={s.pinned ? 'Unpin (stop staying on top)' : 'Pin on top'}
        aria-label={s.pinned ? 'Unpin' : 'Pin on top'}
        onClick={() => send({ type: 'pin' })}
      >
        <Pin on={s.pinned} />
      </button>
      <button className="round" title="Hide  ⌃`" aria-label="Hide Rail" onClick={() => send({ type: 'hide' })}><Hide /></button>
    </div>
  );
}
