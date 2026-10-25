// One byte budget for the decoded page bitmaps the viewer keeps.
//
// The whole-page cache, the tile cache, the continuous view's bitmap cache
// and its resident page canvases each used to have their own cap, so together
// they could hold 640 MB of pixels. Each now registers here with the bytes it
// holds and a way to drop its least recently used entry. After an insert, the
// largest cache gives up entries until the total fits the budget again.
//
// A cache never drops its newest entry for the budget (its evict returns 0),
// so the bitmap a view just rendered always stays.

export const BITMAP_BUDGET_BYTES = 384 * 1024 * 1024;

const caches = new Map();

/**
 * @param {string} name
 * @param {{ bytes: () => number, evictOldest: () => number }} cache
 *   `bytes` reports the pixel bytes held; `evictOldest` drops the least
 *   recently used entry and returns the bytes freed (0 when nothing can go).
 */
export function registerBitmapCache(name, cache) {
  caches.set(name, cache);
}

function bytesOf(cache) {
  try {
    const bytes = cache.bytes();
    return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  } catch {
    return 0;
  }
}

/** Pixel bytes held by every registered cache. */
export function bitmapBudgetUsed() {
  let total = 0;
  for (const cache of caches.values()) total += bytesOf(cache);
  return total;
}

/** Evict from the largest caches until the total fits `budget`. @returns {number} bytes freed */
export function enforceBitmapBudget(budget = BITMAP_BUDGET_BYTES) {
  const sizes = new Map();
  let total = 0;
  for (const [name, cache] of caches) {
    const bytes = bytesOf(cache);
    sizes.set(name, bytes);
    total += bytes;
  }
  let freedTotal = 0;
  const exhausted = new Set();
  while (total > budget) {
    let pick = null;
    for (const [name, bytes] of sizes) {
      if (bytes > 0 && !exhausted.has(name) && (pick === null || bytes > sizes.get(pick))) pick = name;
    }
    if (pick === null) break;
    let freed = 0;
    try { freed = caches.get(pick).evictOldest(); } catch { freed = 0; }
    if (!(freed > 0)) {
      exhausted.add(pick);
      continue;
    }
    sizes.set(pick, Math.max(0, sizes.get(pick) - freed));
    total -= freed;
    freedTotal += freed;
  }
  return freedTotal;
}
