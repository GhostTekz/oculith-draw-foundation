// Canvas drawing of a dynamic stamp design, from the same layout the PDF
// appearance uses (stamp-layout.js). Works on any CanvasRenderingContext2D
// (the app canvas, the editor preview, @napi-rs/canvas in the node tests).

import { layoutStampDesign } from './stamp-layout.js';

export const STAMP_CANVAS_FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';

const images = new Map();
/**
 * A loaded image for a data URL, or null while it loads (`onLoad` runs once
 * it is ready). Without a DOM Image (node tests) the image is skipped.
 */
function stampImage(dataUrl, onLoad) {
  if (!dataUrl || typeof Image === 'undefined') return null;
  let entry = images.get(dataUrl);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, waiting: new Set() };
    images.set(dataUrl, entry);
    img.onload = () => { entry.ready = true; for (const fn of entry.waiting) fn(); entry.waiting.clear(); };
    img.src = dataUrl;
  }
  if (entry.ready) return entry.img;
  if (onLoad) entry.waiting.add(onLoad);
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (!r) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Draw a design into the box (0, 0, width, height) of the current transform.
 * The design is stretched to the box, as the PDF appearance stretches it.
 * @param {{ image?: object }} [opts]  opts.image: a ready image to use
 *   (tests); opts.onImageLoad: called when a not-yet-loaded image arrives
 */
export function drawStampDesign(ctx, design, width, height, opts = {}) {
  const layout = layoutStampDesign(design);
  if (!(layout.width > 0 && layout.height > 0 && width > 0 && height > 0)) return layout;
  ctx.save();
  ctx.scale(width / layout.width, height / layout.height);
  ctx.strokeStyle = design.color;
  ctx.fillStyle = design.color;
  ctx.setLineDash?.([]);
  for (const border of layout.borders) {
    ctx.lineWidth = border.lw;
    roundRect(ctx, border.x, border.y, border.w, border.h, border.r);
    ctx.stroke();
  }
  if (layout.image) {
    const img = opts.image || stampImage(design.image?.dataUrl, opts.onImageLoad);
    if (img) ctx.drawImage(img, layout.image.x, layout.image.y, layout.image.w, layout.image.h);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const text of layout.texts) {
    ctx.font = `${text.bold ? 'bold ' : ''}${text.size}px ${STAMP_CANVAS_FONT}`;
    ctx.fillText(text.text, text.x, text.baseline);
  }
  ctx.restore();
  return layout;
}
