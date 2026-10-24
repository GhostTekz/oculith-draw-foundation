// Live conduit / cable tray gesture, drawn inside the annotation redraw
// (rendering.js) so a viewport frame cannot wipe it or leave the previous
// leg behind. The placed corners are a real run. The leg under the cursor
// is only liveLegLines: straight, at the run's width, with no rungs and no
// elbow offset. That offset is what threw a rail across the sheet while
// the cursor was still moving, for both cable tray and true-size conduit.

import { liveLegLines } from '../../annotations/raceway.js';
import { drawRaceway } from '../../annotations/rendering/raceway-draw.js';

let gesture = null;
let skipLive = false;
let frame = 0;

/** Bump when the annotation canvas is repainted, so a cached sheet is dropped. */
export function bumpAnnotationFrame() { frame += 1; }
export function annotationFrame() { return frame; }

/**
 * @param {{ page, ann, color, screenScale, live: { a, b, half } | null } | null} next
 */
export function setRacewayGesture(next) { gesture = next || null; }
export function clearRacewayGesture() { gesture = null; }

/** While a clean sheet is copied, the moving leg is stroked afterwards. */
export function setRacewaySkipLive(value) { skipLive = !!value; }

function strokeLive(ctx, g, scale) {
  if (!g?.live) return;
  const lines = liveLegLines(g.live.a, g.live.b, g.live.half);
  if (!lines.length) return;
  const s = scale > 0 ? scale : 1;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = g.color;
  ctx.lineWidth = 1.5 / s;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  for (const line of lines) {
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    ctx.lineTo(line[1].x, line[1].y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Page space. The context is already in the annotation transform. */
export function drawRacewayGesture(ctx, pageNum, effectiveScale) {
  const g = gesture;
  if (!g || !ctx || g.page !== pageNum) return;
  const scale = g.screenScale > 0 ? g.screenScale : effectiveScale;
  ctx.save();
  ctx.globalAlpha = 0.85;
  if (g.ann?.points?.length >= 2) {
    drawRaceway(ctx, g.ann, g.color, 1.5 / (scale > 0 ? scale : 1), g.ann.junction || null);
  }
  ctx.restore();
  if (!skipLive) strokeLive(ctx, g, scale);
}

/** The moving leg only. Call after the annotation transform is applied. */
export function strokeRacewayLiveLeg(ctx, effectiveScale) {
  if (skipLive) return;
  strokeLive(ctx, gesture, gesture?.screenScale > 0 ? gesture.screenScale : effectiveScale);
}
