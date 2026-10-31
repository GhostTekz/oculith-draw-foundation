// Layout, filtering and keyboard movement for the floating thumbnail tile.
// Pure functions: the window component supplies sizes and page captions.

/** Thumbnail widths (CSS px) for the S / M / L toggle. */
export const TILE_SIZES = Object.freeze({ s: 84, m: 124, l: 176 });
export const TILE_PAD = 6;
export const TILE_GAP = 6;
export const TILE_CAPTION = 30;
/** The most pages the tile asks its drawing window to render at once. */
export const TILE_MAX_PAGES = 48;

/** Columns, tile width and row height for a viewport width and size step. */
export function gridMetrics(viewportWidth, size = 'm') {
  const target = TILE_SIZES[size] || TILE_SIZES.m;
  const inner = Math.max(target, Math.floor(viewportWidth) - 2 * TILE_PAD);
  const columns = Math.max(1, Math.floor((inner + TILE_GAP) / (target + TILE_GAP)));
  const tileWidth = Math.floor((inner - (columns - 1) * TILE_GAP) / columns);
  // Drawing sheets are mostly landscape; a 3:4 box suits both orientations.
  const imageHeight = Math.round(tileWidth * 0.75);
  return { columns, tileWidth, imageHeight, rowHeight: imageHeight + TILE_CAPTION + 8 + TILE_GAP };
}

/**
 * The slice of `total` items (indexes into the filtered list) to draw, with
 * spacer heights above and below. Never more than `maxItems` items.
 */
export function visibleSlice(total, metrics, scrollTop, viewportHeight, overscanRows = 1, maxItems = TILE_MAX_PAGES) {
  if (!total) return { start: 0, end: 0, top: 0, bottom: 0 };
  const { columns, rowHeight } = metrics;
  const rows = Math.ceil(total / columns);
  const firstRow = Math.max(0, Math.min(rows - 1, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscanRows));
  const maxRows = Math.max(1, Math.floor(maxItems / columns));
  const wantRows = Math.ceil(Math.max(1, viewportHeight) / rowHeight) + 1 + 2 * overscanRows;
  const lastRow = Math.min(rows, firstRow + Math.min(maxRows, wantRows));
  return {
    start: firstRow * columns,
    end: Math.min(total, lastRow * columns),
    top: firstRow * rowHeight,
    bottom: Math.max(0, rows - lastRow) * rowHeight,
  };
}

/** Scroll offset that brings item `index` fully into view (unchanged when it is). */
export function scrollToShow(index, metrics, scrollTop, viewportHeight) {
  if (index < 0) return scrollTop;
  const top = Math.floor(index / metrics.columns) * metrics.rowHeight;
  const bottom = top + metrics.rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}

/** The caption under one thumbnail: sheet number or page label, then the title. */
export function pageCaption(page, info) {
  const sheet = String(info?.sheet || '').trim();
  const label = String(info?.label || '').trim();
  const title = String(info?.title || '').trim();
  const primary = sheet || label || String(page);
  const secondary = title || (sheet && label && label !== sheet ? label : '');
  return { primary, secondary, page };
}

const norm = (text) => String(text ?? '').toLocaleLowerCase().normalize('NFKD');

/**
 * Page numbers that match every word of `query` against the page number,
 * page label, sheet number and title. An empty query keeps every page.
 */
export function filterPages(count, infoFor, query) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const pages = [];
  for (let page = 1; page <= count; page++) {
    if (!words.length) { pages.push(page); continue; }
    const info = infoFor(page) || {};
    const text = norm(`${page} ${info.label || ''} ${info.sheet || ''} ${info.title || ''}`);
    if (words.every((word) => text.includes(word))) pages.push(page);
  }
  return pages;
}

/** New item index after a navigation key in a grid of `columns`; null for other keys. */
export function stepIndex(index, key, columns, total) {
  if (!total) return null;
  const from = index < 0 ? 0 : index;
  const step = {
    ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns,
    PageUp: -columns * 4, PageDown: columns * 4,
  }[key];
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  if (step === undefined) return null;
  if (index < 0) return 0;
  return Math.max(0, Math.min(total - 1, from + step));
}

const MAX_CAPTION = 120;
const captionText = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, MAX_CAPTION);
const pathKey = (value) => String(value ?? '').trim().replace(/\\/g, '/').toLocaleLowerCase();

/**
 * Caption data per page of one document: its PDF page label, and the sheet
 * number and title the drawing set records for that file and page.
 * @returns {Array<[label: string, sheet: string, title: string]>}
 */
export function tilePageInfo(count, labels, sheets, filePath) {
  const info = Array.from({ length: Math.max(0, count) }, (_, index) => [captionText(labels?.[index]), '', '']);
  const path = pathKey(filePath);
  if (!path || !Array.isArray(sheets)) return info;
  for (const sheet of sheets) {
    const page = Number(sheet?.page);
    if (pathKey(sheet?.filePath) !== path || !Number.isSafeInteger(page) || page < 1 || page > count) continue;
    info[page - 1][1] = captionText(sheet.label);
    info[page - 1][2] = captionText(sheet.title);
  }
  return info;
}

/** A page list from the tile: unique whole pages of the current document, bounded. */
export function validTilePages(pages, count) {
  if (!Array.isArray(pages) || !pages.length || pages.length > TILE_MAX_PAGES) return null;
  const seen = new Set();
  for (const page of pages) {
    if (!Number.isSafeInteger(page) || page < 1 || page > count || seen.has(page)) return null;
    seen.add(page);
  }
  return [...seen];
}
