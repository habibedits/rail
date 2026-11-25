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
    case 'mail': return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m3.5 7.5 8.5 6 8.5-6" /></svg>;
    case 'calendar': return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;
    case 'agents': return <svg {...p}><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12" /></svg>;
    case 'focus': return <svg {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="3" /></svg>;
  }
}

export const NewChat = () => (<svg {...base}><path d="M8 3.5H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" /><path d="M11.5 2.5l2 2L8 10H6V8z" /></svg>);
export const More = () => (<svg {...base}><circle cx="4" cy="8" r=".6" fill="currentColor" /><circle cx="8" cy="8" r=".6" fill="currentColor" /><circle cx="12" cy="8" r=".6" fill="currentColor" /></svg>);

// Mail actions, on the same 24px grid as the space symbols.
export function MailIcon({ id, size = 17 }: { id: 'reply' | 'archive' | 'trash' | 'block' | 'compose' | 'person' | 'search' | 'check' | 'paperclip'; size?: number }) {
  const p = { ...sym, width: size, height: size };
  switch (id) {
    case 'reply': return <svg {...p}><path d="M20 19v-4a6 6 0 0 0-6-6H4" /><path d="m9 14-5-5 5-5" /></svg>;
    case 'archive': return <svg {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>;
    case 'trash': return <svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>;
    case 'block': return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>;
    case 'compose': return <svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
    case 'person': return <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
    case 'search': return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case 'check': return <svg {...p}><path d="m5 12 5 5 9-10" /></svg>;
    case 'paperclip': return <svg {...p}><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7" /></svg>;
  }
}
