// Tool Chest count presets: the appearance a count preset keeps. A dot count
// keeps colour and opacity (unchanged since the first count presets); a
// symbol count also keeps its count symbol, size, whether numbers show, and
// the name of its count category. The category name, never a document's
// category id or numbers, is what travels: placing the preset counts in the
// category of that name, which has a stable id so numbering continues in a
// reopened file.

import { getCountSymbol } from '../symbols/count-symbols.js';
import { COUNT_SYMBOL_SIZE } from '../annotations/count-marker.js';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
export const COUNT_CATEGORY_NAME_LIMIT = 48;

/** A usable category name (trimmed, 1-48 printable characters) or null. */
export function cleanCountCategoryName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, COUNT_CATEGORY_NAME_LIMIT).trim();
  return name && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null;
}

/** Stable category id for a preset category name (same name, same id, in any session). */
export function countPresetCategoryId(name) {
  const clean = cleanCountCategoryName(name) || 'count';
  let hash = 0x811c9dc5;
  for (const ch of clean.toLocaleLowerCase()) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const slug = clean.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '').slice(0, 32);
  return `preset-${slug ? `${slug}-` : ''}${hash.toString(36)}`;
}

/** Saved appearance of a count markup, or {} when it cannot be a preset. */
export function cleanCountStyle(source) {
  const style = {};
  for (const key of ['color', 'strokeColor']) {
    if (typeof source[key] === 'string' && HEX_COLOR.test(source[key])) style[key] = source[key];
  }
  if (!style.color && !style.strokeColor) return {};
  if (typeof source.opacity === 'number' && Number.isFinite(source.opacity)
      && source.opacity >= 0 && source.opacity <= 1) style.opacity = source.opacity;
  if (source.markerStyle !== 'symbol') {
    style.markerStyle = 'dot';
    return style;
  }
  // A symbol count keeps its look only when the symbol can be drawn and
  // saved (symbols/count-symbols.js); an unknown symbol saves as a dot.
  const symbol = getCountSymbol(source.symbolId);
  if (!symbol) return {};
  const size = Number(source.symbolSize);
  style.markerStyle = 'symbol';
  style.symbolId = symbol.id;
  style.symbolSize = Number.isFinite(size) && size >= COUNT_SYMBOL_SIZE.min && size <= COUNT_SYMBOL_SIZE.max
    ? Math.round(size * 10) / 10 : COUNT_SYMBOL_SIZE.default;
  style.showNumber = source.showNumber !== false;
  style.countCategory = cleanCountCategoryName(source.countCategory) || symbol.labelEn;
  return style;
}
