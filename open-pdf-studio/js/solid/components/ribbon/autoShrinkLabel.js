const MIN_FONT_SIZE = 7;
const DEFAULT_FONT_SIZE = 10;
const MAX_LINES = 2;

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    const el = m.target.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
    if (el) shrink(el);
  }
});

// True when the label overflows its box. Vertical: more than MAX_LINES
// lines. Horizontal: a word wider than the box — `word-break: normal`
// forbids mid-word breaks, so long words (e.g. "Schermafbeelding") don't
// wrap and were silently clipped by `overflow: hidden` (#158). scrollHeight
// only detects the vertical case, so check scrollWidth too.
function overflows(el, maxHeight) {
  return el.scrollHeight > maxHeight || el.scrollWidth > el.clientWidth;
}

function shrink(el) {
  if (!el || !el.parentElement) return;

  // Reset to default size
  el.style.fontSize = '';
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || (DEFAULT_FONT_SIZE * 1.15);
  const maxHeight = lineHeight * MAX_LINES + 1; // allow 2 lines

  let size = DEFAULT_FONT_SIZE;
  // If content overflows the box (too many lines, or an unbreakable word
  // that is clipped at the edge), reduce font size until it fits.
  while (overflows(el, maxHeight) && size > MIN_FONT_SIZE) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}

/**
 * Attach to a ribbon-btn-label span via ref.
 * Shrinks font-size so text fits within 2 lines without breaking words.
 */
export function autoShrinkLabel(el) {
  requestAnimationFrame(() => shrink(el));
  observer.observe(el, { childList: true, characterData: true, subtree: true });
}
