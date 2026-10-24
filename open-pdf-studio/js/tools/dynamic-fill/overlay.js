// Dynamic Fill preview, drawn by the annotation render pass (rendering.js)
// so a zoom or viewport repaint keeps it: the filled regions (islands cut
// out), the temporary boundary lines, and the boundary being drawn. The
// context is already in page space (annotation coordinates).

import { state } from '../../core/state.js';
import { getEffectiveScale } from '../effective-scale.js';
import { overlayFor, options } from './session.js';

/** '#rrggbb' → 'rgba(r, g, b, alpha)'. */
export function withAlpha(hex, alpha) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return `rgba(0, 150, 255, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function ringPath(ctx, ring) {
  ctx.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
  ctx.closePath();
}

export function drawDynamicFillOverlay(ctx, pageNum) {
  if (state.currentTool !== 'dynamicFill' || !ctx) return;
  const data = overlayFor(pageNum);
  if (!data) return;
  const px = 1 / (getEffectiveScale() || 1);
  const { fillColor, boundaryColor } = options();
  const FILL = withAlpha(fillColor, 0.28);
  const EDGE = withAlpha(fillColor, 0.95);
  const BOUNDARY = boundaryColor;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  for (const r of data.regions) {
    ctx.beginPath();
    ringPath(ctx, r.outer);
    for (const h of r.holes) ringPath(ctx, h);
    ctx.fillStyle = FILL;
    ctx.fill('evenodd');
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
  }
  ctx.strokeStyle = BOUNDARY;
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([6 * px, 4 * px]);
  const lines = [...data.boundaries];
  if (data.draft.length) lines.push(data.hover ? [...data.draft, data.hover] : data.draft);
  for (const line of lines) {
    if (line.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = BOUNDARY;
  for (const p of data.draft) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5 * px, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
