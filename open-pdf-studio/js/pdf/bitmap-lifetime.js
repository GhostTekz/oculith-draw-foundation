// ImageBitmap lifetime for the single-page viewport.
//
// The page, tile and progressive caches close an ImageBitmap when they drop
// it, to bound memory. The viewport may still be painting that bitmap: the
// page cache drops its oldest entry first, a tile prewarm can push out the
// tile on screen, and an invalidation (save, native layer change, an edited
// /AP markup) drops every entry of the document at once. drawImage() on a
// closed bitmap throws InvalidStateError. _render() had already filled the
// sheet white by then, and the exception escaped the rAF tick, so the
// drawing stayed white until something re-initialised the viewport.
//
// Every cache closes through closeBitmap(). A bitmap the viewport still
// shows (current or held page bitmap or tile) is parked instead, and
// releaseUnshownBitmaps() closes it once the viewport has moved on.

const parked = new Set();

function shownByViewport(bitmap) {
  const vp = globalThis.__pdfViewport;
  if (!vp || !bitmap) return false;
  return vp.currentBitmap === bitmap
    || vp.currentTile === bitmap
    || vp.heldBitmap === bitmap
    || vp.heldTile === bitmap;
}

function closeNow(bitmap) {
  try { bitmap.close(); } catch { /* already closed */ }
}

/** Close a bitmap a cache dropped, unless the viewport still shows it. */
export function closeBitmap(bitmap) {
  if (!bitmap || typeof bitmap.close !== 'function') return;
  if (shownByViewport(bitmap)) {
    parked.add(bitmap);
    return;
  }
  parked.delete(bitmap);
  closeNow(bitmap);
}

/** Close the parked bitmaps the viewport no longer shows. @returns {number} closed */
export function releaseUnshownBitmaps() {
  if (parked.size === 0) return 0;
  let closed = 0;
  for (const bitmap of parked) {
    if (shownByViewport(bitmap)) continue;
    parked.delete(bitmap);
    closeNow(bitmap);
    closed++;
  }
  return closed;
}

/** Number of bitmaps waiting for the viewport to let go (tests, diagnostics). */
export function parkedBitmapCount() {
  return parked.size;
}

/**
 * Can drawImage() use this bitmap? A closed (detached) ImageBitmap reports a
 * 0×0 size; drawing it throws instead of drawing nothing.
 */
export function isUsableBitmap(bitmap) {
  return !!bitmap && bitmap.width > 0 && bitmap.height > 0;
}
