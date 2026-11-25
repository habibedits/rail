// Notion keeps ~96px side margins designed for wide windows. In Rail's narrow
// pane that wastes a quarter of the width. This trims them while the pane is
// narrow: 44px on the left, so a block's ⋮⋮ drag handle (which Notion draws in
// the margin, left of the block) stays inside the pane and away from the
// window's edge, and 16px on the right. It reads layout (computed styles), never page content, and
// doesn't rely on Notion's class names, which change often.

const NARROW_MAX = 640; // only act when the pane is this narrow (CSS px)
const MIN_MARGIN = 60; // margins at least this wide are "desktop" margins
const GUTTER = 16; // right margin
const LEFT = 44; // left margin: room for the ⋮⋮ block handle
const MARK = 'data-rail-compact';

const CSS = `
  [style*="padding-left: calc(96px"], [style*="padding-inline-start: calc(96px"] {
    padding-left: calc(${LEFT}px + env(safe-area-inset-left)) !important;
    padding-inline-start: calc(${LEFT}px + env(safe-area-inset-left)) !important;
  }
  [style*="padding-right: calc(96px"], [style*="padding-inline-end: calc(96px"] {
    padding-right: calc(${GUTTER}px + env(safe-area-inset-right)) !important;
    padding-inline-end: calc(${GUTTER}px + env(safe-area-inset-right)) !important;
  }
  /* Notes only: no "Add icon / Add cover / Add verification / Customize layout" row. */
  .notion-page-controls { display: none !important; }
  /* In narrow windows Notion caps text, toggle and meeting-note blocks at a
     fixed max-width (about half the pane). Let them use the full width; media
     blocks keep their own sizing. */
  .notion-selectable:not(.notion-image-block):not(.notion-video-block):not(.notion-embed-block):not(.notion-bookmark-block)[style*="max-width"] { max-width: 100% !important; }
  [style*="padding-left: 96px"] { padding-left: ${LEFT}px !important; }
  [style*="padding-right: 96px"] { padding-right: ${GUTTER}px !important; }
`;

// "[full-start] 96px [content-start] 708px [content-end] 96px [full-end]"
// -> keep the line names, shrink the outer tracks, let the middle fill.
function compactGrid(el: HTMLElement) {
  const cs = getComputedStyle(el);
  if (cs.display !== 'grid') return;
  const tpl = cs.gridTemplateColumns;
  const parts = tpl.match(/\[[^\]]*\]|[^\s\[]+/g);
  if (!parts) return;
  const tracks = parts.filter((p) => !p.startsWith('['));
  if (tracks.length !== 3) return;
  const [l, , r] = tracks.map((t) => parseFloat(t));
  if (!(l >= MIN_MARGIN && r >= MIN_MARGIN)) return;
  let i = 0;
  const sizes = [`${LEFT}px`, 'minmax(0, 1fr)', `${GUTTER}px`];
  const next = parts.map((p) => (p.startsWith('[') ? p : sizes[i++])).join(' ');
  el.style.setProperty('grid-template-columns', next, 'important');
  el.setAttribute(MARK, '1');
}

function compactPadding(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const pl = parseFloat(cs.paddingLeft);
  const pr = parseFloat(cs.paddingRight);
  // Symmetric wide padding on a block that spans the pane = page margin.
  if (pl >= MIN_MARGIN && pr >= MIN_MARGIN && Math.abs(pl - pr) < 8 && el.clientWidth >= window.innerWidth * 0.8) {
    el.style.setProperty('padding-left', `${LEFT}px`, 'important');
    el.style.setProperty('padding-right', `${GUTTER}px`, 'important');
    el.setAttribute(MARK, '1');
  }
}

// Notes only: hide the "Add a property" button under page properties. Its
// classes are generated, so it's found by its label.
function hideAddProperty() {
  document.querySelectorAll<HTMLElement>('[role="button"]:not([data-rail-hidden])').forEach((b) => {
    if (b.textContent?.trim() !== 'Add a property') return;
    const row = b.parentElement && b.parentElement.childElementCount === 1 ? b.parentElement : b;
    row.style.setProperty('display', 'none', 'important');
    b.setAttribute('data-rail-hidden', '1');
  });
  // Notion's "Upgrade" and "Open in Notion app" (with its ▾) buttons in the
  // page header: hidden in Rail. Matched by their exact text, since Notion's
  // class names are generated.
  document.querySelectorAll<HTMLElement>('.notion-frame [role="button"]:not([data-rail-hidden]), .notion-topbar [role="button"]:not([data-rail-hidden])').forEach((b) => {
    const t = b.textContent?.trim();
    if (t !== 'Upgrade' && t !== 'Open in Notion app') return;
    const box = b.closest<HTMLElement>('[data-popup-origin]') ?? b;
    box.style.setProperty('display', 'none', 'important');
    b.setAttribute('data-rail-hidden', '1');
  });
}

function scan() {
  if (window.innerWidth > NARROW_MAX) return;
  // The main page lives in .notion-frame; side peeks and centre peeks are
  // rendered outside it, and every page body uses a `.layout` grid.
  const roots = document.querySelectorAll<HTMLElement>('.notion-frame, .notion-peek-renderer, .layout');
  if (roots.length === 0) { if (document.body) walk(document.body, 0); return; }
  roots.forEach((r) => walk(r, 0));
}

// Margins live on the page scaffold, not inside the content: stop at content
// blocks and cap the depth so this stays cheap while Notion re-renders.
// Checks are idempotent (an already-compacted element no longer qualifies),
// so re-running after Notion resets an element's style just reapplies it.
function walk(el: HTMLElement, depth: number) {
  compactGrid(el);
  compactPadding(el);
  if (depth >= 14) return;
  for (const child of Array.from(el.children) as HTMLElement[]) {
    if (child.hasAttribute('data-block-id') && !child.classList.contains('notion-page-block')) continue;
    walk(child, depth + 1);
  }
}

function undo() {
  document.querySelectorAll<HTMLElement>(`[${MARK}]`).forEach((el) => {
    el.style.removeProperty('grid-template-columns');
    el.style.removeProperty('padding-left');
    el.style.removeProperty('padding-right');
    el.removeAttribute(MARK);
  });
}

// Notion's pop-ups (search, menus, dialogs) are sized for a desktop window and
// get cut off at Rail's width. Shrink any pop-up that spills past the pane so
// it fits with a small edge, and shift it back on screen.
const EDGE = 8;
const FIT = 'data-rail-fit';

function fitOverlays() {
  const vw = window.innerWidth;
  document.querySelectorAll<HTMLElement>('.notion-overlay-container').forEach((c) => fitWalk(c, 0, vw));
}

function fitWalk(el: HTMLElement, depth: number, vw: number) {
  if (depth > 0 && el.hasAttribute(FIT)) {
    // Notion re-positions some pop-ups after they open (e.g. "Move to" once
    // its page list loads). Nudge an already-fitted pop-up back on screen.
    const r = el.getBoundingClientRect();
    const off = r.left < EDGE - 0.5 ? EDGE - r.left : r.right > vw - EDGE + 0.5 ? vw - EDGE - r.right : 0;
    if (r.width > 0 && Math.abs(off) >= 1) {
      const cur = parseFloat(el.style.getPropertyValue('translate')) || 0;
      el.style.setProperty('translate', `${Math.round(cur + off)}px 0`, 'important');
    }
    // fall through: a child can still be placed outside it (the "Move to"
    // panel is positioned off its anchor), so check the children too.
  } else
  if (depth > 0) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.left < -0.5 || r.right > vw + 0.5)) {
      const w = vw - 2 * EDGE;
      el.style.setProperty('width', `${w}px`, 'important');
      el.style.setProperty('max-width', `${w}px`, 'important');
      el.style.setProperty('min-width', '0', 'important');
      el.style.removeProperty('translate');
      const r2 = el.getBoundingClientRect();
      const dx = Math.round(EDGE - r2.left);
      if (dx !== 0) el.style.setProperty('translate', `${dx}px 0`, 'important');
      el.setAttribute(FIT, '1');
    }
  }
  if (depth >= 8) return;
  // Content inside a scrolling box (e.g. the search filter chips) is meant to overflow.
  if (depth > 0 && getComputedStyle(el).overflowX !== 'visible') return;
  for (const child of Array.from(el.children) as HTMLElement[]) fitWalk(child, depth + 1, vw);
}

function unfit() {
  document.querySelectorAll<HTMLElement>(`[${FIT}]`).forEach((el) => {
    for (const p of ['width', 'max-width', 'min-width', 'translate']) el.style.removeProperty(p);
    el.removeAttribute(FIT);
  });
}

// Notion's AI Meeting Notes block (the note taker and transcription card) is
// not used in Rail: it's hidden at every width. Found by its block type, and,
// in case Notion renames that, by the transcription button inside it.
const NO_AI_NOTES = `
  [class*="notion-meeting_note"], [class*="notion-transcription"] { display: none !important; }
`;

function hideAiNotes() {
  document.querySelectorAll<HTMLElement>('[role="button"][aria-label^="More transcri"]:not([data-rail-hidden])').forEach((b) => {
    b.setAttribute('data-rail-hidden', '1');
    const block = b.closest<HTMLElement>('[data-block-id]');
    if (block && !block.classList.contains('notion-page-block')) block.style.setProperty('display', 'none', 'important');
  });
}

export function installNotionCompact() {
  let style: HTMLStyleElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const apply = () => {
    const narrow = window.innerWidth <= NARROW_MAX;
    if (narrow && !style) {
      style = document.createElement('style');
      style.textContent = CSS;
      document.documentElement.appendChild(style);
    } else if (!narrow && style) {
      style.remove();
      style = null;
      undo();
    }
    scan();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 250);
  };

  // Pop-ups are fitted on the next frame so they never show cut off.
  let raf = 0;
  const onMutate = () => {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; fitOverlays(); hideAddProperty(); hideAiNotes(); });
    schedule();
  };

  document.addEventListener('DOMContentLoaded', () => {
    const noAi = document.createElement('style');
    noAi.textContent = NO_AI_NOTES;
    document.documentElement.appendChild(noAi);
    apply();
    hideAddProperty();
    hideAiNotes();
    new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true });
    // Pop-ups can also move without any DOM being added (style-only
    // re-positioning), so re-check while one is open.
    setInterval(() => {
      if (window.innerWidth <= NARROW_MAX && document.querySelector('.notion-overlay-container > *')) fitOverlays();
    }, 200);
  });
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return; // height-only (divider drag)
    lastWidth = window.innerWidth;
    undo(); // re-measure from Notion's own layout at the new width
    unfit();
    fitOverlays();
    schedule();
  });
}
