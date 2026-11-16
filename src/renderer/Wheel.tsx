import { useEffect, useState } from 'react';
import { send, type WheelState } from './rail';

// The space wheel: a ring of every space, drawn over the whole panel. The main
// process decides which slice is picked (it follows the pointer); this view
// only draws it. Slice 0 is at the top, then clockwise.
const ICON: Record<string, string> = {
  claude: '✳️', notion: '📓', meetings: '🎙️', slack: '💬', calendar: '📅', agents: '🤖', focus: '🍅',
};

function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
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
  const ri = r * 0.38;
  const seg = (2 * Math.PI) / n;
  const gap = 0.025;
  const picked = hover >= 0 ? spaces[hover] : null;
  const reach = Math.hypot(w.px, w.py);
  const k = reach > r * 0.92 ? (r * 0.92) / reach : 1;

  return (
    <div className="wheel-root">
      <svg width="100%" height="100%" className="wheel-svg">
        <g className="wheel-ring" style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r={r + 6} className="wheel-plate" />
          {spaces.map((s, i) => {
            const mid = -Math.PI / 2 + i * seg;
            const a0 = mid - seg / 2 + gap;
            const a1 = mid + seg / 2 - gap;
            const lr = (ri + r) / 2;
            const lx = cx + lr * Math.cos(mid);
            const ly = cy + lr * Math.sin(mid);
            const on = i === hover;
            return (
              <g key={s.id} className={`wheel-slice ${on ? 'on' : ''} ${i === active ? 'current' : ''}`}>
                <path d={sector(cx, cy, ri, r, a0, a1)} />
                <text x={lx} y={ly - 7} className="wheel-ic">{ICON[s.id] ?? '•'}</text>
                <text x={lx} y={ly + 13} className="wheel-name">{s.name}</text>
                {typeof s.badge === 'number' && s.badge > 0 && (
                  <g>
                    <circle cx={lx + 15} cy={ly - 17} r={8} className="wheel-badge" />
                    <text x={lx + 15} y={ly - 13.5} className="wheel-badge-t">{s.badge > 9 ? '9+' : s.badge}</text>
                  </g>
                )}
                {i === active && <circle cx={cx + (r - 7) * Math.cos(mid)} cy={cy + (r - 7) * Math.sin(mid)} r={2.5} className="wheel-here" />}
              </g>
            );
          })}
          <circle cx={cx} cy={cy} r={ri - 5} className="wheel-hub" />
          <text x={cx} y={cy - 2} className="wheel-hub-name">{picked ? picked.name : spaces[active]?.name}</text>
          <text x={cx} y={cy + 13} className="wheel-hub-hint">
            {picked ? `⌃${hover + 1}` : w.sticky ? 'pick one · esc' : w.via === 'key' ? 'glide, let go' : 'nudge, let go'}
          </text>
          {!w.sticky && <circle cx={cx + w.px * k} cy={cy + w.py * k} r={4} className="wheel-reticle" />}
        </g>
      </svg>
    </div>
  );
}
