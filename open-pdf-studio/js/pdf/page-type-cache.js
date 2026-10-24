// JS-side mirror of the Rust PageTypeCache. The Rust cache makes per-page
// analyze invokes return instantly when warm, but during cold-open the IPC
// queue gets saturated by thumbnail render invokes (~28 for a 28-page PDF)
// — a renderPage's analyze invoke can wait 1+ seconds in queue even though
// the actual Rust work is microseconds.
//
// Populating THIS cache from the analyze_page_type_batch result lets
// renderer.js skip the IPC roundtrip entirely on cache hits. The Rust cache
// is still authoritative for cold misses (first navigation before batch
// completes); this is a perf overlay on top.
//
// Cache keys are (filePath, pageIndex) — 0-indexed page numbers matching
// the Rust side. Values: 'vector' | 'tile'.

const _cache = new Map(); // key = `${filePath}::${pageIndex}`, value = 'vector' | 'tile'

function _key(filePath, pageIndex) {
  return `${filePath}::${pageIndex}`;
}

export function getCachedPageType(filePath, pageIndex) {
  return _cache.get(_key(filePath, pageIndex)) ?? null;
}

export function cachePageType(filePath, pageIndex, type) {
  if (type === 'vector' || type === 'tile') {
    _cache.set(_key(filePath, pageIndex), type);
  }
}

/**
 * Populate the cache from an analyze_page_type_batch result.
 * @param {string} filePath
 * @param {string[]} results — array of 'vector' | 'tile' strings, ordered
 *   by page index (0..N-1).
 */
export function cacheBatchResults(filePath, results, startIndex = 0) {
  for (let i = 0; i < results.length; i++) {
    const t = results[i];
    if (t === 'vector' || t === 'tile') _cache.set(_key(filePath, startIndex + i), t);
  }
}

/** Drop every entry for the given file (call on doc close / file replace). */
export function evictFile(filePath) {
  const prefix = `${filePath}::`;
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}

/** Drop every entry (call on app shutdown or memory pressure). */
export function evictAll() {
  _cache.clear();
}

/** Diagnostic: how many entries are cached right now. */
export function cacheSize() {
  return _cache.size;
}
