// Space wheel triggers, installed in every Rail view (sites and Rail's own UI).
// The middle mouse button opens the wheel; the main process does the rest
// (it follows the pointer itself, so it works whichever pane you clicked in).
// Middle-click's usual job (open link in a new tab) is switched off in Rail.
export type WheelSignal = 'down' | 'up' | 'altclick';

export function installWheelTrigger(send: (s: WheelSignal) => void) {
  const stop = (e: MouseEvent) => { e.preventDefault(); e.stopImmediatePropagation(); };
  window.addEventListener('mousedown', (e) => {
    if (e.button === 1) { stop(e); send('down'); }
    else if (e.altKey) send('altclick'); // Option-click is a click, not a wheel hold
  }, true);
  window.addEventListener('mouseup', (e) => { if (e.button === 1) { stop(e); send('up'); } }, true);
  window.addEventListener('auxclick', (e) => { if (e.button === 1) stop(e); }, true);
}
