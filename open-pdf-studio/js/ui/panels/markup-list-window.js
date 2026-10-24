// Window math for the Markups List. The row order, grouping and Shift-click
// span stay in annotations-list.js. This module only decides which of the
// already-shown rows are mounted.

export const MARKUP_LIST_ROW_PX = 24;
export const MARKUP_LIST_REPLY_PX = 28;
export const MARKUP_LIST_REPLY_INPUT_PX = 40;
export const MARKUP_LIST_HEADER_PX = 30;
export const MARKUP_LIST_WINDOW_AT = 80;
export const MARKUP_LIST_OVERSCAN = 8;

export function rowHeight(item) {
  if (item?.isReplyInput) return MARKUP_LIST_REPLY_INPUT_PX;
  if (item?.isReply) return MARKUP_LIST_REPLY_PX;
  return MARKUP_LIST_ROW_PX;
}

export function rowOffsets(heights) {
  const offsets = new Array((heights?.length || 0) + 1);
  offsets[0] = 0;
  let total = 0;
  for (let i = 0; i < (heights?.length || 0); i++) {
    total += heights[i];
    offsets[i + 1] = total;
  }
  return offsets;
}

/**
 * Rows whose block intersects the scrollport, plus `overscan` row-heights
 * on each side. The sticky column header occupies `headerHeight` at the top
 * of the scrollport, and the row block starts after that header.
 */
export function windowForScroll({
  heights,
  scrollTop = 0,
  viewportHeight = 0,
  headerHeight = MARKUP_LIST_HEADER_PX,
  overscan = MARKUP_LIST_OVERSCAN,
}) {
  const list = Array.isArray(heights) ? heights : [];
  const count = list.length;
  const offsets = rowOffsets(list);
  const total = offsets[count] || 0;
  if (!count) return { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0, offsets };

  const overscanPx = overscan * MARKUP_LIST_ROW_PX;
  const top = Math.max(0, scrollTop);
  const visibleTop = top + headerHeight;
  const visibleBottom = top + Math.max(0, viewportHeight);
  let start = 0;
  while (start < count && headerHeight + offsets[start + 1] <= visibleTop - overscanPx) start += 1;
  let end = start;
  while (end < count && headerHeight + offsets[end] < visibleBottom + overscanPx) end += 1;
  return {
    start,
    end,
    padTop: offsets[start],
    padBottom: total - offsets[end],
    total,
    offsets,
  };
}

/** Short lists stay fully mounted. Longer lists mount the scroll window. */
export function markupListSlice(shown, {
  scrollTop = 0,
  viewportHeight = 0,
  limit = MARKUP_LIST_WINDOW_AT,
  overscan = MARKUP_LIST_OVERSCAN,
} = {}) {
  const list = Array.isArray(shown) ? shown : [];
  const heights = list.map(rowHeight);
  if (list.length <= limit) {
    const offsets = rowOffsets(heights);
    return {
      virtual: false,
      start: 0,
      end: list.length,
      padTop: 0,
      padBottom: 0,
      total: offsets[list.length] || 0,
      offsets,
    };
  }
  return {
    virtual: true,
    ...windowForScroll({ heights, scrollTop, viewportHeight, overscan }),
  };
}

/**
 * Scroll offset that puts shown-row `index` fully inside the scrollport.
 * Returns `scrollTop` when that row is already fully visible.
 */
export function scrollTopToReveal(offsets, index, scrollTop, viewportHeight, headerHeight = MARKUP_LIST_HEADER_PX) {
  const top = Number.isFinite(scrollTop) ? scrollTop : 0;
  if (!offsets || index < 0 || index + 1 >= offsets.length) return top;
  if (!(viewportHeight > 0)) return top;
  const rowTop = headerHeight + offsets[index];
  const rowBottom = headerHeight + offsets[index + 1];
  const viewTop = top + headerHeight;
  const viewBottom = top + viewportHeight;
  // Any overlap counts as on screen, so selecting a row the user can already
  // see does not move the list.
  if (rowBottom > viewTop + 0.5 && rowTop < viewBottom - 0.5) return top;
  if (rowTop < viewTop) return Math.max(0, rowTop - headerHeight);
  return Math.max(0, rowBottom - viewportHeight);
}

/**
 * The next markup an arrow key activates. Group rows stop the walk, matching
 * the list's previous DOM walk, which only followed rows with an annotation id.
 * Replies and section headers are not arrow targets.
 */
export function nextArrowMarkup(shown, currentId, direction) {
  const focusable = [];
  for (let i = 0; i < (shown?.length || 0); i++) {
    const item = shown[i];
    if (!item || item.isHeader || item.isReply || item.isReplyInput) continue;
    focusable.push({ index: i, item });
  }
  const current = focusable.findIndex((row) => !row.item.isMarkupGroup && row.item.id === currentId);
  if (current < 0) return null;
  const next = focusable[current + direction];
  if (!next || next.item.isMarkupGroup || !next.item.id) return null;
  return { index: next.index, item: next.item };
}
