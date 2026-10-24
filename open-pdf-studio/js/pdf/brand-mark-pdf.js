// The Oculith mark (the monolith with its eye, branding/oculith-logo.svg) on
// a pdf-lib page, for the footer of the reports the app writes. pdf-lib
// fills paths non-zero, so the logo's even-odd path is drawn as its three
// parts: the slab, the eye in white over it, and the pupil.

import { rgb } from 'pdf-lib';

// The logo's paths, moved to start at 0,0 (it spans 212 x 332 units).
const SLAB = 'M18,0 H194 Q212,0 212,18 V314 Q212,332 194,332 H18 Q0,332 0,314 V18 Q0,0 18,0 Z';
const EYE = 'M106,56 Q198,166 106,276 Q14,166 106,56 Z';
const PUPIL = 'M86,166 A20,20 0 1,0 126,166 A20,20 0 1,0 86,166 Z';
const W = 212, H = 332;
const ORANGE = rgb(0xf2 / 255, 0x6b / 255, 0x1f / 255);
const WHITE = rgb(1, 1, 1);

/**
 * Draw the mark with its bottom-left corner at (x, y) in PDF points, `size`
 * points tall. Returns its width, for placing text after it.
 */
export function drawBrandMark(page, x, y, size = 10) {
  const scale = size / H;
  const at = { x, y: y + size, scale };
  page.drawSvgPath(SLAB, { ...at, color: ORANGE, borderWidth: 0 });
  page.drawSvgPath(EYE, { ...at, color: WHITE, borderWidth: 0 });
  page.drawSvgPath(PUPIL, { ...at, color: ORANGE, borderWidth: 0 });
  return W * scale;
}
