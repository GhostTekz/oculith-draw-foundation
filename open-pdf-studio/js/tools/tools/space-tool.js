/**
 * Space tools (Spaces panel ▸ Rectangle / Polygon): draw the outline of a
 * new space. Not a markup: the outline becomes a stored space
 * (spaces/actions.js addSpace) on the page it was drawn on.
 *
 *   spaceRect     drag a rectangle, or click two corners
 *   spacePolygon  click the corners; double-click, Enter or a click on the
 *                 first corner closes it; Backspace removes the last corner
 *
 * Esc or right-click cancels. The draft is drawn by spaces/overlay.js.
 * Snapping uses the same ctx.snap as the drawing tools.
 */
import { getActiveDocument } from '../../core/state.js';
import { setSpaceDraft, spaceDraft } from '../../spaces/overlay.js';
import { addSpace } from '../../spaces/actions.js';
import { MIN_GEBIED_PX, schermPxNaarPt } from '../../annotations/minimummaat.js';

const draft = { page: null, points: [], dragging: false, start: null };

function reset(ctx) {
  draft.page = null; draft.points = []; draft.dragging = false; draft.start = null;
  setSpaceDraft(null);
  ctx?.redraw?.();
}

function pointOf(ctx) {
  const s = typeof ctx.snap === 'function' ? ctx.snap(ctx.x, ctx.y) : null;
  return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : { x: ctx.x, y: ctx.y };
}

function pageOf(ctx) {
  return ctx.pageNum || getActiveDocument()?.currentPage || 1;
}

function rectPoints(a, b) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

function show(ctx, points, cursor) {
  setSpaceDraft({ page: draft.page, points, cursor });
  ctx.redraw();
}

function finish(ctx, points) {
  const page = draft.page;
  reset(ctx);
  if (!points || points.length < 3) return;
  addSpace({ page, points });
}

export const spaceRectTool = {
  name: 'spaceRect',
  cursor: 'crosshair',
  onPointerDown(ctx, e) {
    if (e.button === 2) { if (draft.start) { reset(ctx); e.preventDefault?.(); } return; }
    if (e.button !== 0 || e.detail === 2) return;
    const p = pointOf(ctx);
    if (!draft.start) {
      draft.page = pageOf(ctx);
      draft.start = p;
      draft.dragging = true;
      show(ctx, [p], p);
      return;
    }
    const minPt = schermPxNaarPt(MIN_GEBIED_PX, ctx.scale);
    if (Math.abs(p.x - draft.start.x) < minPt || Math.abs(p.y - draft.start.y) < minPt) return;
    finish(ctx, rectPoints(draft.start, p));
  },
  onPointerMove(ctx) {
    if (!draft.start) return;
    const p = pointOf(ctx);
    show(ctx, rectPoints(draft.start, p), null);
  },
  onPointerUp(ctx) {
    if (!draft.start || !draft.dragging) return false;
    draft.dragging = false;
    const p = pointOf(ctx);
    const minPt = schermPxNaarPt(MIN_GEBIED_PX, ctx.scale);
    // A click without a drag waits for the second corner.
    if (Math.abs(p.x - draft.start.x) < minPt || Math.abs(p.y - draft.start.y) < minPt) return true;
    finish(ctx, rectPoints(draft.start, p));
    return true;
  },
  onEscape(ctx) {
    if (!draft.start) return false;
    reset(ctx);
    return true;
  },
  onDeactivate(ctx) { if (draft.start || spaceDraft()) reset(ctx); },
};

export const spacePolygonTool = {
  name: 'spacePolygon',
  cursor: 'crosshair',
  onPointerDown(ctx, e) {
    if (e.button === 2) { if (draft.points.length) { reset(ctx); e.preventDefault?.(); } return; }
    if (e.button !== 0) return;
    if (e.detail === 2) {
      // The double-click's own clicks already added its corner (twice).
      const pts = draft.points.filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-6);
      if (pts.length >= 3) finish(ctx, pts);
      return;
    }
    const p = pointOf(ctx);
    if (!draft.points.length) {
      draft.page = pageOf(ctx);
      draft.points = [p];
      show(ctx, draft.points, p);
      return;
    }
    const first = draft.points[0];
    const closePt = schermPxNaarPt(8, ctx.scale);
    if (draft.points.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) <= closePt) {
      finish(ctx, [...draft.points]);
      return;
    }
    draft.points = [...draft.points, p];
    show(ctx, draft.points, p);
  },
  onPointerMove(ctx) {
    if (!draft.points.length) return;
    show(ctx, draft.points, pointOf(ctx));
  },
  onKeyDown(ctx, e) {
    if (!draft.points.length) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft.points.length >= 3) finish(ctx, [...draft.points]);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      draft.points = draft.points.slice(0, -1);
      if (!draft.points.length) reset(ctx);
      else show(ctx, draft.points, null);
    }
  },
  onEscape(ctx) {
    if (!draft.points.length) return false;
    reset(ctx);
    return true;
  },
  onDeactivate(ctx) { if (draft.points.length || spaceDraft()) reset(ctx); },
};
