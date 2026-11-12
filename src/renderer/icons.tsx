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
export const Caret = () => (<svg {...base} width={10} height={10}><path d="M4 6l4 4 4-4" /></svg>);
