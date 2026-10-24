// Screen drawing of the measurement extras (measure-extras.js): per-segment
// values along a polyline measurement and the centroid marker of an area.
import { segmentLabels, centroidMarker } from '../measure-extras.js';
import { leesbareHoek } from '../maat-label.js';

/** Segment values at each segment midpoint, along the segment, on a light box. */
export function drawSegmentLabels(ctx, annotation, color) {
  const labels = segmentLabels(annotation);
  if (!labels.length) return;
  ctx.save();
  ctx.font = '10px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const label of labels) {
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(leesbareHoek(label.angle));
    const w = ctx.measureText(label.text).width + 4;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(-w / 2, -14, w, 12);
    ctx.fillStyle = color;
    ctx.fillText(label.text, 0, -3);
    ctx.restore();
  }
  ctx.restore();
}

/** Centroid marker: a small circle with a cross. */
export function drawCentroidMarker(ctx, annotation, color) {
  const c = centroidMarker(annotation);
  if (!c) return;
  const r = 4;
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.moveTo(c.x - r * 1.8, c.y); ctx.lineTo(c.x + r * 1.8, c.y);
  ctx.moveTo(c.x, c.y - r * 1.8); ctx.lineTo(c.x, c.y + r * 1.8);
  ctx.stroke();
  ctx.restore();
}
