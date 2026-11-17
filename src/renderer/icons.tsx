// Minimal 14px line icons, drawn in currentColor.
const base = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const Back = () => (<svg {...base}><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>);
export const Reload = () => (<svg {...base}><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v3h-3" /></svg>);
export const Plus = () => (<svg {...base}><path d="M8 3v10M3 8h10" /></svg>);
export const External = () => (<svg {...base}><path d="M9 3h4v4" /><path d="M13 3 7.5 8.5" /><path d="M11.5 9.5V13h-8.5V4.5H7" /></svg>);
export const AppIcon = () => (<svg {...base}><rect x="3" y="3" width="10" height="10" rx="2" /><path d="M6 6v4M6 6l4 4V6" /></svg>);
export const Pin = ({ on }: { on: boolean }) => (
  <svg {...base} fill={on ? 'currentColor' : 'none'}><path d="M6 2.5h4l-.5 4 2 2v1h-7v-1l2-2z" /><path d="M8 9.5V14" /></svg>
);
export const Hide = () => (<svg {...base}><path d="M6 3.5 10.5 8 6 12.5" /><path d="M13 3v10" /></svg>);
export const ChevronUp = () => (<svg {...base}><path d="M4 10l4-4 4 4" /></svg>);
export const ChevronDown = () => (<svg {...base}><path d="M4 6l4 4 4-4" /></svg>);
export const Forward = () => (<svg {...base}><path d="M6 3.5 10.5 8 6 12.5" /></svg>);
export const Up = () => (<svg {...base}><path d="M8 13V3.5M4 7.5l4-4 4 4" /></svg>);
export const Down = () => (<svg {...base}><path d="M8 3v9.5M4 8.5l4 4 4-4" /></svg>);
export const Caret = () => (<svg {...base} width={10} height={10}><path d="M4 6l4 4 4-4" /></svg>);

// Space symbols (the tab bar and the space wheel), drawn on a 24px grid.
const sym = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function SpaceIcon({ id, size = 18 }: { id: string; size?: number }) {
  const p = { ...sym, width: size, height: size };
  switch (id) {
    case 'claude': return <svg {...p}><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" /></svg>;
    case 'notion': return <svg {...p}><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case 'meetings': return <svg {...p}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></svg>;
    case 'slack': return <svg {...p}><path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-5 3.5V18H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></svg>;
    case 'calendar': return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;
    case 'agents': return <svg {...p}><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12" /></svg>;
    case 'focus': return <svg {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="3" /></svg>;
  }
}

export const NewChat = () => (<svg {...base}><path d="M8 3.5H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" /><path d="M11.5 2.5l2 2L8 10H6V8z" /></svg>);
export const More = () => (<svg {...base}><circle cx="4" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="8" r=".6" fill="currentColor" /><circle cx="12" cy="8" r=".6" fill="currentColor" /></svg>);
