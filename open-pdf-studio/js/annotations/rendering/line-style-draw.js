// Draws a custom line style (annotations/line-styles.js) on the canvas. The
// layout is shared with the saved appearance (pdf/saver/line-style-ap.js), so
// the screen and other viewers show the same pieces, dots, text and symbols.

import { resolveLineStyle, layoutLineStyle, lineStyleWidth, lineStyleMargin } from '../line-styles.js';
import { userLineStyles } from '../custom-style-prefs.js';

/** The resolved style of an annotation, or null when it draws a plain line. */
export function lineStyleOf(annotation) {
  return annotation?.lineStyleId ? resolveLineStyle(annotation, userLineStyles()) : null;
}

/** How far (page points) the style of `annotation` reaches beside its line; 0 without a style. */
export function lineStyleBoundsMargin(annotation) {
  const style = lineStyleOf(annotation);
  return style ? lineStyleMargin(style, lineStyleWidth(annotation)) : 0;
}

/** Draw a layout in `color`. `lw` maps a page-point width to the drawn width (screen rules). */
export function drawLineStyleLayout(ctx, layout, color, lw = (w) => w) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  for (const s of layout.strokes) {
    ctx.lineWidth = lw(s.width);
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  }
  if (layout.dots.length) {
    ctx.beginPath();
    for (const d of layout.dots) { ctx.moveTo(d.x + d.r, d.y); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); }
    ctx.fill();
  }
  for (const sh of layout.shapes) {
    ctx.lineWidth = lw(sh.width);
    ctx.beginPath();
    ctx.moveTo(sh.points[0].x, sh.points[0].y);
    for (let i = 1; i < sh.points.length; i++) ctx.lineTo(sh.points[i].x, sh.points[i].y);
    if (sh.closed) ctx.closePath();
    if (sh.fill) ctx.fill();
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const t of layout.texts) {
    ctx.save();
    ctx.translate(t.baseX, t.baseY);
    ctx.rotate(t.angle);
    // Helvetica metrics (Arial is metric-compatible): the saved appearance
    // uses the standard /Helv font and the same widths (maatlijn-inline.js).
    ctx.font = `${t.size}px Helvetica, Arial, "Liberation Sans", sans-serif`;
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Draw `annotation` along `points` with its line style. Returns false when the
 * annotation has no (known) style, so the caller draws its plain line.
 */
export function tekenLijnstijl(ctx, annotation, points, color, lw) {
  const style = lineStyleOf(annotation);
  if (!style) return false;
  const layout = layoutLineStyle(style, points, { lineWidth: lineStyleWidth(annotation) });
  drawLineStyleLayout(ctx, layout, color, lw);
  return true;
}
