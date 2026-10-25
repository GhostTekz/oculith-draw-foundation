// A construction set this size is opened on the sheet in front of the user.
// The rest of the pages stay on disk until that sheet, or the next one, is shown.

export const LARGE_PAGE_COUNT = 40;
export const LARGE_FILE_BYTES = 48 * 1024 * 1024;
// Read by byte range instead of whole at open (loader.js). Measured: a
// 563 MB set took 13.4 s to read whole and opened in 5.7 s by range, while
// a 50 MB set read whole in 0.25 s and its first sheet's markups came
// slower by range (scattered objects, many small reads).
export const RANGE_OPEN_BYTES = 192 * 1024 * 1024;
const PAGE_TYPE_CHUNK = 8;

export function isLargeOpen({ numPages = 0, byteLength = 0 } = {}) {
  return numPages >= LARGE_PAGE_COUNT || byteLength >= LARGE_FILE_BYTES;
}

// The open sheet, then the neighbours. Order matters: the sheet on screen
// is read first.
export function openAnnotationWindow(currentPage, numPages) {
  const last = numPages | 0;
  const current = Math.min(last, Math.max(1, currentPage | 0));
  const pages = [];
  for (const pageNum of [current, current + 1, current - 1]) {
    if (pageNum >= 1 && pageNum <= last && !pages.includes(pageNum)) pages.push(pageNum);
  }
  return pages;
}

// One classify invoke for a short file. A large set is split so a sync
// command does not sit in front of the sheet on screen.
export function pageTypeChunks(numPages, large) {
  const total = Math.max(0, numPages | 0);
  const size = large ? PAGE_TYPE_CHUNK : Math.max(1, total);
  const chunks = [];
  for (let start = 0; start < total; start += size) {
    const pageIndices = [];
    const end = Math.min(total, start + size);
    for (let i = start; i < end; i++) pageIndices.push(i);
    chunks.push(pageIndices);
  }
  return chunks;
}
