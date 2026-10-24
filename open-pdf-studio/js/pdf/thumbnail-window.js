// Fixed row geometry lets the sidebar mount only the rows near its viewport.
// A row uses the image aspect ratio and the thumbnail panel's content width.
const ROW_CHROME_PX = 32;
const ROW_GAP_PX = 4;

export function thumbnailRowHeights(count, imageWidth, getSize, placeholder) {
  const width = Math.max(1, imageWidth);
  const heights = [];
  for (let page = 1; page <= count; page++) {
    const size = getSize(page) || placeholder;
    const ratio = size?.width > 0 && size?.height > 0 ? size.height / size.width : 1.414;
    // The image keeps its own pixel width (140px in the native renderer)
    // and only shrinks when the sidebar is narrower. Using the entire
    // sidebar width here creates empty virtual rows tall enough for the
    // picture to scroll out of view before the next row is mounted.
    const displayedWidth = Math.min(width, size?.width > 0 ? size.width : width);
    heights.push(Math.ceil(displayedWidth * ratio) + ROW_CHROME_PX + ROW_GAP_PX);
  }
  return heights;
}

export function thumbnailWindow(heights, scrollTop, viewportHeight, overscan = 3) {
  const offsets = new Array(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + heights[i];
  const totalHeight = offsets[heights.length];
  if (!heights.length) return { start: 0, end: 0, top: 0, bottom: 0, offsets };
  const first = findRow(offsets, Math.max(0, scrollTop));
  const last = findRow(offsets, Math.max(0, scrollTop + viewportHeight));
  const start = Math.max(0, first - overscan);
  const end = Math.min(heights.length, last + 1 + overscan);
  return { start, end, top: offsets[start], bottom: totalHeight - offsets[end], offsets };
}

function findRow(offsets, pixel) {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= pixel) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, offsets.length - 2);
}
