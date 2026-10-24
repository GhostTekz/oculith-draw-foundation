// Screen drawing of conduit and cable tray runs (annotations/raceway.js):
// the centre line, or at true size the rails, rungs or basket mesh, plus the
// run label. The scale comes from the run itself (measurePxPerIn, written by
// the measurement computation), so the drawing and the takeoff always agree.
// `junction` (raceway.js branchJunction) adds a branch's tee / cross /
// reducer where it starts on its parent.

import { racewayDrawing, racewayLabelPlace } from '../raceway.js';

function strokePath(ctx, path) {
  if (!path || path.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
}

export function drawRaceway(ctx, ann, color, lineWidth = 1, junction = null) {
  const pts = ann.points;
  if (!Array.isArray(pts) || pts.length < 2) return;
  const d = racewayDrawing(pts, ann.raceway, ann.measurePxPerIn || null, junction);
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (const l of d.lines) strokePath(ctx, l);
  ctx.lineWidth = Math.max(lineWidth * 0.5, 0.25);
  for (const l of d.thin) strokePath(ctx, l);
  if (ann.measureText && ann.measureShowLabel !== false) {
    const place = racewayLabelPlace(pts, d.widthPx / 2 + 6);
    ctx.font = '10px Arial';
    const w = ctx.measureText(ann.measureText).width + 6;
    // A level label stays over the run's own width, so a long label beside a
    // short end leg does not run off the sheet.
    if (Math.abs(Math.cos(place.angle)) > 0.9) {
      const xs = pts.map((p) => p.x);
      const lo = Math.min(...xs) + w / 2, hi = Math.max(...xs) - w / 2;
      place.x = lo <= hi ? Math.min(hi, Math.max(lo, place.x)) : (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    ctx.translate(place.x, place.y);
    ctx.rotate(place.angle);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(-w / 2, -13, w, 13);
    ctx.fillStyle = ann.measureBendWarning ? '#c92a2a' : color;
    ctx.fillText(ann.measureText, 0, -2);
  }
  ctx.restore();
}
