// A symbol count marker: the count symbol centred on the count point and,
// unless switched off, its number to the lower right. One function draws it
// on the annotation canvas (rendering.js) and into the canvas-to-PDF recorder
// for the saved appearance (saver.js), so screen and PDF match.

import { getCountSymbol } from '../symbols/count-symbols.js';

// Same range as construction symbol counts (symbolSize, /OPS_SymbolSize).
export const COUNT_SYMBOL_SIZE = Object.freeze({ min: 4, max: 480, default: 22 });

/** Symbol size in page points (4-480, default 22). */
export function countSymbolSize(ann) {
  const s = Number(ann?.symbolSize);
  return Number.isFinite(s) && s >= COUNT_SYMBOL_SIZE.min && s <= COUNT_SYMBOL_SIZE.max
    ? s : COUNT_SYMBOL_SIZE.default;
}

/** Does this count draw a known count symbol (otherwise the numbered dot)? */
export function countUsesSymbol(ann) {
  return ann?.type === 'count' && ann.markerStyle === 'symbol' && !!getCountSymbol(ann.symbolId);
}

/** Number label font size for a symbol size (7-24 pt). */
export function countNumberSize(size) {
  return Math.min(24, Math.max(7, Math.round(size * 0.45 * 10) / 10));
}

/** Half extent around the count point for hit testing and selection. */
export function countMarkerRadius(ann) {
  return countUsesSymbol(ann) ? Math.max(11, countSymbolSize(ann) / 2 + 1) : 11;
}

/**
 * Draw a symbol count marker in app space (page points, y down). The caller
 * sets globalAlpha for the markup opacity.
 */
export function drawCountSymbolMarker(ctx, ann) {
  const symbol = getCountSymbol(ann.symbolId);
  if (!symbol) return false;
  const size = countSymbolSize(ann);
  const color = ann.color || ann.strokeColor || '#e11d48';
  ctx.save();
  ctx.translate(ann.x - size / 2, ann.y - size / 2);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
  symbol.draw(ctx, { width: size, height: size, color }, {});
  ctx.restore();
  if (ann.showNumber !== false && ann.number !== undefined && ann.number !== null && ann.number !== '') {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `bold ${countNumberSize(size)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(ann.number), ann.x + size / 2 + 1, ann.y + size / 2);
    ctx.restore();
  }
  return true;
}
