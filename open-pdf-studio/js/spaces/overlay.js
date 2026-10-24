// Space outlines on the canvas: a dashed outline in the space's colour, a
// light tint, and the name at the label point. Editing aid only: drawn in
// the view (single page and continuous), never in print, export or the
// saved appearance. The Spaces panel switches the outlines on and off and
// marks the selected space; the space tools draw their draft here too.

import { collectSpaces } from './model.js';

const view = {
  outlines: true,
  selectedId: null,
  /** Draft of the space being drawn: { page, points, cursor } or null. */
  draft: null,
};

export function spaceOutlinesVisible() { return view.outlines; }
export function setSpaceOutlinesVisible(on) { view.outlines = !!on; }
export function selectedSpaceIdForView() { return view.selectedId; }
export function setSelectedSpaceIdForView(id) { view.selectedId = id || null; }
export function spaceDraft() { return view.draft; }
export function setSpaceDraft(draft) { view.draft = draft || null; }

function rgba(hex, alpha) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return `rgba(47, 128, 237, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function tracePath(ctx, points, close = true) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (close) ctx.closePath();
}

/**
 * Draw the space outlines of `page` on a context already transformed to app
 * page space. `effectiveScale`: canvas pixels per page unit (keeps lines
 * and text the same size on screen).
 */
export function drawSpaceOverlay(ctx, doc, page, effectiveScale = 1) {
  if (!ctx || !doc) return;
  const px = 1 / (effectiveScale || 1);
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  if (view.outlines || view.selectedId) {
    let spaces;
    try { spaces = collectSpaces(doc); } catch { spaces = []; }
    for (const s of spaces) {
      if (s.page !== page) continue;
      const selected = s.id === view.selectedId;
      if (!selected && (!view.outlines || s.hidden)) continue;
      ctx.save();
      tracePath(ctx, s.points);
      ctx.fillStyle = rgba(s.color, selected ? 0.18 : 0.06);
      ctx.fill();
      ctx.strokeStyle = rgba(s.color, 0.9);
      ctx.lineWidth = (selected ? 2.5 : 1.25) * dpr * px;
      ctx.setLineDash(s.source === 'room' ? [2 * dpr * px, 3 * dpr * px] : [6 * dpr * px, 4 * dpr * px]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.label) {
        const size = 11 * dpr * px;
        ctx.font = `${selected ? '600 ' : ''}${size}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Below a room's own tag (which sits on the same label point).
        const y = s.source === 'room' ? s.label.y + size * 1.6 : s.label.y;
        ctx.lineWidth = 3 * dpr * px;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.strokeText(s.name, s.label.x, y);
        ctx.fillStyle = rgba(s.color, 1);
        ctx.fillText(s.name, s.label.x, y);
      }
      ctx.restore();
    }
  }
  const d = view.draft;
  if (d && d.page === page && d.points?.length) {
    const pts = d.cursor ? [...d.points, d.cursor] : d.points;
    ctx.save();
    tracePath(ctx, pts, pts.length > 2);
    ctx.fillStyle = 'rgba(47, 128, 237, 0.10)';
    if (pts.length > 2) ctx.fill();
    ctx.strokeStyle = 'rgba(47, 128, 237, 0.95)';
    ctx.lineWidth = 1.5 * dpr * px;
    ctx.setLineDash([6 * dpr * px, 4 * dpr * px]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(47, 128, 237, 0.95)';
    for (const p of d.points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * dpr * px, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
