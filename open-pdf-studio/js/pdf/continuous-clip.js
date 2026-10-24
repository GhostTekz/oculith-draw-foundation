// Continuous view: the markup canvas of a page covers only the visible part
// of that page plus a margin (renderer.js setupContinuousAnnotationCanvas).
// Scrolling used to re-clip it every 120 ms: a new backing store and a full
// markup redraw per visible page, also when the clip, with its 256 px margin,
// still covered the view. These helpers decide when the clip still holds.

/**
 * The visible part of a page, in page-relative CSS px of a page drawn
 * `breedte`×`hoogte`: `cr` the scroll container's rect, `ccr` the page
 * container's rect (both client rects; ccr may still be at the old size).
 * @returns {{l: number, t: number, r: number, b: number}|null} null if not visible
 */
export function zichtbaarPaginaDeel(cr, ccr, breedte, hoogte) {
  if (!cr || !ccr || !(ccr.width > 1) || !(ccr.height > 1)) return null;
  const fx = breedte / ccr.width;
  const fy = hoogte / ccr.height;
  const l = Math.max(0, (cr.left - ccr.left) * fx);
  const t = Math.max(0, (cr.top - ccr.top) * fy);
  const r = Math.min(breedte, (cr.right - ccr.left) * fx);
  const b = Math.min(hoogte, (cr.bottom - ccr.top) * fy);
  return r > l && b > t ? { l, t, r, b } : null;
}

/**
 * Does the canvas's current clip still cover `zicht` for a page of
 * `breedte`×`hoogte` at `dpr`? `clip` is what the last setup stored:
 * {x, y, w, h, paginaW, paginaH, dpr}.
 */
export function clipDektZicht(clip, zicht, breedte, hoogte, dpr) {
  if (!clip || !zicht) return false;
  const eps = 0.5;
  const getal = (v) => Number.isFinite(v);
  if (![clip.x, clip.y, clip.w, clip.h, clip.paginaW, clip.paginaH, clip.dpr].every(getal)) return false;
  return Math.abs(clip.paginaW - breedte) < eps
    && Math.abs(clip.paginaH - hoogte) < eps
    && Math.abs(clip.dpr - dpr) < 1e-6
    && clip.x <= zicht.l + eps
    && clip.y <= zicht.t + eps
    && clip.x + clip.w >= zicht.r - eps
    && clip.y + clip.h >= zicht.b - eps;
}

/** The clip a canvas's dataset records (setupContinuousAnnotationCanvas). */
export function clipUitDataset(ds) {
  if (!ds) return null;
  const n = (k) => parseFloat(ds[k]);
  return {
    x: n('clipX'), y: n('clipY'), w: n('clipW'), h: n('clipH'),
    paginaW: n('clipPaginaW'), paginaH: n('clipPaginaH'), dpr: n('backingScale'),
  };
}
