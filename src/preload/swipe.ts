// Two-finger horizontal swipe detection (PRD §5).
// Electron's `swipe` event is unreliable on macOS, so we sum wheel deltaX
// ourselves. One gesture moves exactly one space: after firing (or after the
// gesture touched something that scrolls horizontally) we stay locked until
// the wheel stream goes quiet, which also swallows trackpad momentum.

const THRESHOLD = 120; // px of accumulated horizontal travel
const QUIET_MS = 350; // gap that ends a gesture

export function installSwipe(send: (dir: 1 | -1) => void) {
  let acc = 0;
  let locked = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;

  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        acc = 0;
        locked = false;
      }, QUIET_MS);

      if (locked || e.ctrlKey) return; // ctrlKey = pinch-zoom on macOS

      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
      const dx = e.deltaX * scale;
      const dy = e.deltaY * scale;

      if (dx === 0 || Math.abs(dx) <= 2 * Math.abs(dy)) {
        acc = 0;
        return;
      }
      if (canScrollX(e.target, dx)) {
        // Something under the cursor can still scroll that way: let it, and
        // ignore the rest of this gesture so we never jump spaces mid-scroll.
        acc = 0;
        locked = true;
        return;
      }
      acc += dx;
      if (Math.abs(acc) >= THRESHOLD) {
        send(acc > 0 ? 1 : -1);
        acc = 0;
        locked = true;
      }
    },
    { passive: true, capture: true },
  );
}

function canScrollX(target: EventTarget | null, dx: number): boolean {
  let el: Element | null = target instanceof Element ? target : null;
  const root = document.scrollingElement;
  while (el) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (el === root || ox === 'auto' || ox === 'scroll' || ox === 'overlay') {
        if (hasRoom(el, dx)) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

function hasRoom(el: Element, dx: number) {
  const left = Math.abs(el.scrollLeft); // abs() handles RTL negative scrollLeft
  return dx > 0 ? left + el.clientWidth < el.scrollWidth - 1 : left > 1;
}
