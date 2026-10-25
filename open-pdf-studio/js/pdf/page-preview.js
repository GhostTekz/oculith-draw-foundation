// page-preview.js
//
// A quick whole-page render at low resolution, shown while the real bitmap
// of a heavy sheet is still on its way (loader.js starts it at open, beside
// the file read). It is kept as the page's preview in the page bitmap cache,
// so the bitmap orchestrator and the progressive run start from it, and it is
// painted at once when nothing of the page is on screen yet. Tiles and the
// full-quality bitmap replace it; it never takes the place of either.
//
// The heavy app modules are imported inside the functions, so the pure
// helpers load under plain node.

/** Render scale of the preview (PDF points to pixels). */
export const PREVIEW_SCALE = 0.33;

/**
 * Decode the `[w u32 LE][h u32 LE][rgba]` wire format of a page render.
 * @returns {{ w: number, h: number, rgba: Uint8ClampedArray } | null}
 */
export function decodeWireBitmap(raw) {
  if (!raw) return null;
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (bytes.length <= 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const w = view.getUint32(0, true);
  const h = view.getUint32(4, true);
  if (!w || !h || w * h * 4 !== bytes.length - 8) return null;
  return { w, h, rgba: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + 8, w * h * 4) };
}

/**
 * Keep `bitmap` as the preview of the page and show it where the view has
 * nothing better: under the tiles of a running progressive run, or on its
 * own while the view has no bitmap yet.
 * @returns {Promise<boolean>} whether the preview was put on screen now
 */
export async function showPagePreview({ filePath, pageNum, rotation = 0, bitmap, w, h, scale, sourceRevision }) {
  const { setPreviewBitmap } = await import('./page-bitmap-cache.js');
  if (!setPreviewBitmap(filePath, pageNum, rotation, bitmap, w, h, scale, sourceRevision)) return false;
  const { viewport } = await import('./pdf-viewport.js');
  if (!viewport.active || viewport.filePath !== filePath || viewport.pageNum !== pageNum
      || (viewport.rotation || 0) % 360 !== (rotation || 0) % 360 || viewport.pageType !== 'raster') {
    return false;
  }
  const { offerPreviewToProgressiveRun } = await import('./progressive-render.js');
  if (offerPreviewToProgressiveRun(filePath, pageNum, rotation, bitmap)) return true;
  if (viewport.currentBitmap) return false;
  viewport.currentBitmap = bitmap;
  viewport.dirty = true;
  return true;
}
