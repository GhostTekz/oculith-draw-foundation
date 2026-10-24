export function virtualRowKey(item, index) {
  if (item.isHeader) return `header:${item.groupKey}`;
  if (item.isMarkupGroup) return `group:${item.mgId}`;
  if (item.isReplyInput) return `reply-input:${item.parentId}`;
  if (item.isReply) return `reply:${item.parentId}:${item.replyId || 'status'}:${item.date}:${index}`;
  return `annotation:${item.id}`;
}

function estimatedHeight(item) {
  if (item.isReplyInput) return 32;
  if (item.isReply) return 28;
  return 24;
}

export function buildVirtualRows(items, measured = new Map()) {
  const offsets = new Float64Array(items.length + 1);
  for (let index = 0; index < items.length; index++) {
    const height = measured.get(virtualRowKey(items[index], index)) || estimatedHeight(items[index]);
    offsets[index + 1] = offsets[index] + height;
  }
  return { offsets, total: offsets[items.length], count: items.length };
}

function firstEndAfter(offsets, y) {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Return an overscanned slice and the spacer heights around it. */
export function virtualRowWindow(layout, scrollTop, viewportHeight, overscan = 300) {
  const start = layout.count ? Math.min(layout.count - 1,
    firstEndAfter(layout.offsets, Math.max(0, scrollTop - overscan))) : 0;
  const end = Math.min(layout.count, Math.max(start + 1,
    firstEndAfter(layout.offsets, scrollTop + viewportHeight + overscan) + 1));
  return {
    start, end,
    top: layout.offsets[start],
    bottom: layout.total - layout.offsets[end],
  };
}
