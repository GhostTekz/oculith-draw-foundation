// Which page bitmap and tile the single-page viewport paints this frame.
//
// An invalidation (save, native layer change, an imported markup that leaves
// its /AP) used to null viewport.currentBitmap and paint a white sheet until
// PDFium returned the new render: hundreds of milliseconds, seconds on a
// heavy construction sheet. The viewport now holds the last frame it showed
// (heldBitmap/heldTile) and keeps painting it until a fresh page bitmap for
// the same file, page and rotation arrives. Hold and release only change
// which ImageBitmap is drawn; bitmap-lifetime.js keeps a held bitmap open
// while a cache drops it.

import { isUsableBitmap } from './bitmap-lifetime.js';

function normalRotation(rotation) {
  return (((Number(rotation) || 0) % 360) + 360) % 360;
}

/** Key of the page a frame belongs to: file, page and page rotation. */
export function frameKey(filePath, pageNum, rotation) {
  return `${filePath}|${pageNum}|${normalRotation(rotation)}`;
}

export function viewportFrameKey(vp) {
  return frameKey(vp?.filePath, vp?.pageNum, vp?.rotation);
}

function heldMatches(vp) {
  return !!(vp.heldBitmap || vp.heldTile)
    && vp.pageType === 'raster'
    && vp.heldFor === viewportFrameKey(vp);
}

/**
 * Decide what _render() draws. Never returns a closed bitmap.
 * @returns {{bitmap: ImageBitmap|null, tile: ImageBitmap|null, tileMeta: object|null,
 *   detachedBitmap: boolean, detachedTile: boolean, releaseHeld: boolean, usesHeld: boolean}}
 *   detachedBitmap/detachedTile: the current one was closed; drop it and ask
 *   for a new one. releaseHeld: the held frame is no longer needed (a fresh
 *   page bitmap arrived) or belongs to another page; drop the hold.
 */
export function choosePageFrame(vp) {
  const frame = {
    bitmap: null, tile: null, tileMeta: null,
    detachedBitmap: false, detachedTile: false, releaseHeld: false, usesHeld: false,
  };
  if (!vp) return frame;

  let bitmap = vp.currentBitmap || null;
  if (bitmap && !isUsableBitmap(bitmap)) {
    frame.detachedBitmap = true;
    bitmap = null;
  }
  let tile = vp.currentTile && vp.currentTileMeta ? vp.currentTile : null;
  let tileMeta = tile ? vp.currentTileMeta : null;
  if (tile && !isUsableBitmap(tile)) {
    frame.detachedTile = true;
    tile = null;
    tileMeta = null;
  }

  if (vp.heldBitmap || vp.heldTile) {
    if (!heldMatches(vp) || bitmap) {
      frame.releaseHeld = true;
    } else {
      if (isUsableBitmap(vp.heldBitmap)) {
        bitmap = vp.heldBitmap;
        frame.usesHeld = true;
      }
      if (!tile && vp.heldTileMeta && isUsableBitmap(vp.heldTile)) {
        tile = vp.heldTile;
        tileMeta = vp.heldTileMeta;
        frame.usesHeld = true;
      }
    }
  }

  frame.bitmap = bitmap;
  frame.tile = tile;
  frame.tileMeta = tileMeta;
  return frame;
}

/**
 * Keep the frame on screen while its bitmaps are invalidated. An existing
 * hold for the same page stays when there is nothing newer to hold (two
 * invalidations in a row). @returns {boolean} whether a frame is held
 */
export function holdShownFrame(vp) {
  if (!vp) return false;
  const key = viewportFrameKey(vp);
  const bitmap = isUsableBitmap(vp.currentBitmap) ? vp.currentBitmap : null;
  const tile = vp.currentTileMeta && isUsableBitmap(vp.currentTile) ? vp.currentTile : null;
  if (!bitmap && !tile) return heldMatches(vp);
  const samePage = vp.heldFor === key;
  vp.heldBitmap = bitmap || (samePage ? vp.heldBitmap : null);
  vp.heldTile = tile || (samePage && !bitmap ? vp.heldTile : null);
  vp.heldTileMeta = tile ? vp.currentTileMeta : (vp.heldTile ? vp.heldTileMeta : null);
  vp.heldFor = key;
  return true;
}

// ── Continuation across a new working path ──────────────────────────────
// Saving PDF text edits reloads the document from a fresh working copy
// (page-manager.js reloadFromBytes): the same page under a new path. Without
// a continuation setPage() treats it as a new document: no bitmap (white)
// and a fit that throws away the user's zoom.

const ZELFDE = 0.01;

/** Record what the next load must match to continue the current view. */
export function makeContinuation(vp, now, lifetimeMs) {
  if (!vp?.active || !vp.filePath) return null;
  return {
    fromPath: vp.filePath,
    pageNum: vp.pageNum,
    pageW: vp.pageW,
    pageH: vp.pageH,
    originX: vp.originX || 0,
    originY: vp.originY || 0,
    rotation: normalRotation(vp.rotation),
    viewRotation: normalRotation(vp.viewRotation),
    until: now + lifetimeMs,
  };
}

/**
 * Does loading `next` ({filePath, pageNum, pageW, pageH, originX, originY,
 * rotation, viewRotation}) continue the view the continuation `c` recorded
 * from `vp`? Only the same page, size, origin and rotations under another
 * path, before it expires.
 */
export function continuationApplies(c, vp, next, now) {
  if (!c || !vp || !next || now > c.until) return false;
  const gelijk = (a, b) => Math.abs((a || 0) - (b || 0)) < ZELFDE;
  return vp.filePath === c.fromPath
    && !!next.filePath
    && next.filePath !== c.fromPath
    && next.pageNum === c.pageNum
    && gelijk(next.pageW, c.pageW) && gelijk(next.pageH, c.pageH)
    && gelijk(next.originX, c.originX) && gelijk(next.originY, c.originY)
    && normalRotation(next.rotation) === c.rotation
    && normalRotation(next.viewRotation) === c.viewRotation;
}

export function releaseHeldFrame(vp) {
  if (!vp) return;
  vp.heldBitmap = null;
  vp.heldTile = null;
  vp.heldTileMeta = null;
  vp.heldFor = null;
}
