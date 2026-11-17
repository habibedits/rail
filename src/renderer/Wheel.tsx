import { useEffect, useState } from 'react';
import { send, type WheelState } from './rail';
import { SpaceIcon } from './icons';

// The space wheel: a pie of every space, drawn over the whole panel. The main
// process decides which slice is picked (it follows the pointer) and the order
// of the slices; this view only draws them. Slice 0 is at the top, then clockwise.

// One pie slice between angles a0 and a1, from the hub (r0) to the rim (r1).
function slice(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

export function Wheel() {
  const [w, setW] = useState<WheelState | null>(null);
  useEffect(() => window.rail?.onWheel(setW), []);
  useEffect(() => {
    const down = (e: MouseEvent) => { e.preventDefault(); send({ type: 'wheel', action: 'click' }); };
    const ctx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('mousedown', down);
    window.addEventListener('contextmenu', ctx);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('contextmenu', ctx); };
  }, []);
  if (!w?.open) return null;

  const { cx, cy, r, spaces, hover, active } = w;
  const n = spaces.length;
  const hub = r * 0.33;
  const seg = (2 * Math.PI) / n;
  const picked = hover >= 0 ? spaces[hover] : null;
  const shown = picked ?? spaces[active];
  const reach = Math.hypot(w.px, w.py);
  const k = reach > r * 0.92 ? (r * 0.92) / reach : 1;
  const icon = Math.round(Math.max(18, Math.min(24, r * 0.17)));

  return (
    <div className="wheel-root">
      <div className="wheel-ring" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <svg width="100%" height="100%" className="wheel-svg" aria-hidden="true">
          <circle cx={cx} cy={cy} r={r + 7} className="wheel-plate" />
          {spaces.map((s, i) => {
            const mid = -Math.PI / 2 + i * seg;
            return <path key={s.id} d={slice(cx, cy, hub, r, mid - seg / 2, mid + seg / 2)} className={`wheel-slice ${i === hover ? 'on' : ''}`} />;
          })}
          <circle cx={cx} cy={cy} r={hub} className="wheel-hub" />
          {!w.sticky && <circle cx={cx + w.px * k} cy={cy + w.py * k} r={4} className="wheel-reticle" />}
        </svg>
        {spaces.map((s, i) => {
          const mid = -Math.PI / 2 + i * seg;
          const lr = (hub + r) / 2 + 2;
          return (
            <div
              key={s.id}
              className={`wheel-label ${i === hover ? 'on' : ''} ${i === active ? 'current' : ''}`}
              style={{ left: cx + lr * Math.cos(mid), top: cy + lr * Math.sin(mid) }}
            >
              <span className="wheel-ic">
                <SpaceIcon id={s.id} size={icon} />
                {typeof s.badge === 'number' && s.badge > 0 && <span className="badge">{s.badge > 9 ? '9+' : s.badge}</span>}
              </span>
              <span className="wheel-name">{s.name}</span>
            </div>
          );
        })}
        <div className="wheel-hubtext" style={{ left: cx, top: cy }}>
          <b>{shown?.name}</b>
          <span>{picked ? `⌃${picked.index + 1}` : w.sticky ? 'pick one · esc' : w.via === 'key' ? 'glide, let go' : 'flick, let go'}</span>
        </div>
      </div>
    </div>
  );
}
