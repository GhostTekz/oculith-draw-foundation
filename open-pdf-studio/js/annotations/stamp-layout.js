// Layout of a dynamic stamp design (stamp-templates.js), shared by the canvas
// renderer (stamp-draw.js) and the PDF appearance writer
// (pdf/saver/stamp-design-ap.js), so both draw the same thing.
//
// Units are PDF points at the stamp's natural size, origin top-left, y down.
// Text is measured with the Helvetica / Helvetica-Bold metrics the PDF uses
// (Arial and Liberation Sans, the canvas fonts, share them). Text is reduced
// to WinAnsi, the encoding of the standard fonts, on both sides.

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';
import { toWinAnsiText } from '../pdf/saver/pdf-text.js';

const fonts = {};
function font(bold) {
  const key = bold ? 'bold' : 'regular';
  fonts[key] ??= StandardFontEmbedder.for(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  return fonts[key];
}

/** Width of WinAnsi text in Helvetica (bold) at a size, in points. */
export function stampTextWidth(text, size, bold) {
  const embedder = font(bold);
  let width = 0;
  for (const glyph of embedder.encodeTextAsGlyphs(text)) width += embedder.widthOfGlyph(glyph.name);
  return width * size / 1000;
}

export const STAMP_PAD_X = 8;
export const STAMP_PAD_Y = 5;
const IMAGE_GAP = 6;
const ROUND_RADIUS = 4;

/**
 * @param {{ lines: {text: string, size: number, bold: boolean}[], border: string,
 *   image?: {width: number, height: number} }} design
 * @returns {{ width: number, height: number, lineWidth: number,
 *   borders: {x: number, y: number, w: number, h: number, r: number, lw: number}[],
 *   texts: {text: string, x: number, baseline: number, size: number, bold: boolean}[],
 *   image: {x: number, y: number, w: number, h: number}|null }}
 */
export function layoutStampDesign(design) {
  const lines = (design?.lines || []).map(item => ({
    text: toWinAnsiText(item.text, { newlines: 'space' }), size: item.size, bold: !!item.bold,
  }));
  const title = Math.max(...lines.map(item => item.size), 8);
  const lw = design?.border === 'none' ? 0 : Math.max(1.2, Math.round(title * 0.09 * 10) / 10);
  const inset = design?.border === 'double' ? lw * 2.5 : 0;
  // Text block: each line is one size tall plus a fifth of it as leading.
  let y = 0;
  const placed = lines.map((item, index) => {
    if (index > 0) y += item.size * 0.25;
    const baseline = y + item.size * 0.78;
    y += item.size;
    return { ...item, width: stampTextWidth(item.text, item.size, item.bold), baseline };
  });
  const blockH = Math.max(y, title);
  const blockW = Math.max(...placed.map(item => item.width), title);
  const image = design?.image && design.image.width > 0 && design.image.height > 0
    ? { h: blockH, w: blockH * design.image.width / design.image.height } : null;
  const left = STAMP_PAD_X + lw + inset;
  const top = STAMP_PAD_Y + lw + inset;
  const textLeft = left + (image ? image.w + IMAGE_GAP : 0);
  const width = textLeft + blockW + STAMP_PAD_X + lw + inset;
  const height = top + blockH + STAMP_PAD_Y + lw + inset;
  const borders = [];
  if (lw > 0) {
    const r = design.border === 'rounded' ? ROUND_RADIUS : 0;
    borders.push({ x: lw / 2, y: lw / 2, w: width - lw, h: height - lw, r, lw });
    if (design.border === 'double') {
      const lw2 = Math.max(0.8, lw * 0.6);
      const d = lw * 2;
      borders.push({ x: d, y: d, w: width - d * 2, h: height - d * 2, r: 0, lw: lw2 });
    }
  }
  return {
    width, height, lineWidth: lw, borders,
    texts: placed.filter(item => item.text).map(item => ({
      text: item.text, size: item.size, bold: item.bold,
      x: textLeft + (blockW - item.width) / 2, baseline: top + item.baseline,
    })),
    image: image ? { x: left, y: top, w: image.w, h: image.h } : null,
  };
}

/** Natural size of a design in points. */
export function stampDesignSize(design) {
  const { width, height } = layoutStampDesign(design);
  return { width, height };
}

/** Placement scale of a dynamic stamp: larger on large sheets. */
export function dynamicStampScale(pageSize) {
  const longest = Math.max(pageSize?.breedte || 0, pageSize?.hoogte || 0);
  return Math.min(3, Math.max(1, longest / 1200));
}
