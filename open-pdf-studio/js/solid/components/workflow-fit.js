// How the workflow toolbar's tool row (WorkflowBar.jsx) fits its width.
// Pure, so node tests it (workflows.test.mjs).

// Widths of the tool row (styles/workflow-bar.css): an icon-only button and
// the gap after it, a separator with its margins, the More button.
export const ICON_BUTTON_PX = 31;
export const SEPARATOR_PX = 13;
export const MORE_PX = 76;
export const ROW_PADDING_PX = 8;

/**
 * How the tool row fits `available` px: { compactFrom, visibleCount }.
 * groups: [{ full: width with labels, count: tools }] in order. Groups from
 * compactFrom on show icons only (Infinity = none); tools from visibleCount
 * on move into More (Infinity = none). Pure, for tests.
 */
export function planFit({ available, groups }) {
  const icons = (g) => g.count * ICON_BUTTON_PX;
  const seps = Math.max(0, groups.length - 1) * SEPARATOR_PX;
  for (let from = groups.length; from >= 0; from--) {
    const width = seps + groups.reduce((sum, g, i) => sum + (i < from ? g.full : icons(g)), 0);
    if (width <= available) return { compactFrom: from === groups.length ? Infinity : from, visibleCount: Infinity };
  }
  // Icons only and still too wide: cut tools off the end, room for More.
  const room = available - MORE_PX;
  let used = 0;
  let index = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    if (gi > 0) used += SEPARATOR_PX;
    for (let k = 0; k < groups[gi].count; k++) {
      if (used + ICON_BUTTON_PX > room) return { compactFrom: 0, visibleCount: Math.max(1, index) };
      used += ICON_BUTTON_PX;
      index++;
    }
  }
  return { compactFrom: 0, visibleCount: Infinity };
}
