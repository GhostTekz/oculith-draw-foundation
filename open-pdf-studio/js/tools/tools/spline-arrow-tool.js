import { state, getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { catmullRomToBezier, splineArrowEndTangent } from '../../annotations/spline-arrow-geometry.js';
import { drawArrowheadOnCanvas } from '../../annotations/rendering/decorations.js';
import { paintHoverSnap } from '../pointer-snap.js';

/**
 * Spline-arrow tool (issue #267) — a curved arrow that "points around" things.
 *
 * Interaction is IDENTICAL to the polyline/spline tools: click to add points,
 * right-click / double-click / Escape to finish (>= 2 points). The clicked
 * points are stored on the annotation as `points` (exactly like a polyline) so
 * the generic vertex-edit path (handles.js polyline case + transforms.js node
 * drag) applies unchanged. The visible geometry is a smooth Catmull-Rom curve
 * through the points, with an arrowhead at the last point pointing along the
 * curve's end tangent.
 */

// Draw the smooth curve through `pts` onto a canvas context using cubic Béziers.
function strokeSplineArrowCurve(ctx, pts) {
  const segs = catmullRomToBezier(pts);
  if (segs.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(segs[0].x0, segs[0].y0);
  for (const s of segs) ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x1, s.y1);
  ctx.stroke();
}

export const splineArrowTool = {
  name: 'splineArrow',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state: st, canvasCtx } = ctx;
    const prefs = st.preferences;

    // Right-click finishes
    if (e.button === 2) {
      _finishSplineArrow(ctx);
      st._suppressNextContextmenu = true;
      return;
    }

    // Double-click finishes
    if (e.detail === 2) {
      _finishSplineArrow(ctx);
      return;
    }

    // Single click — add point (with snap)
    const snap = ctx.snap(x, y, null, st.splineArrowPoints);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;
    st.splineArrowPoints.push({ x: ptX, y: ptY });
    st.isDrawingSplineArrow = true;
    ctx.redraw();

    // Draw in-progress curve
    if (st.splineArrowPoints.length >= 2) {
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = prefs.arrowStrokeColor || prefs.lineStrokeColor || '#000000';
      canvasCtx.lineWidth = prefs.arrowLineWidth || prefs.lineLineWidth || 2;
      canvasCtx.lineCap = 'round';
      canvasCtx.lineJoin = 'round';
      strokeSplineArrowCurve(canvasCtx, st.splineArrowPoints);
      canvasCtx.restore();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state: st, canvasCtx } = ctx;
    if (!st.isDrawingSplineArrow || st.splineArrowPoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = st.preferences;
    const snap = ctx.snap(x, y, null, st.splineArrowPoints);
    const snapX = snap.snapped ? snap.x : x;
    const snapY = snap.snapped ? snap.y : y;
    st.lastSnapResult = snap.snapped ? snap : null;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    const strokeColor = prefs.arrowStrokeColor || prefs.lineStrokeColor || '#000000';
    const headSize = prefs.arrowHeadSize || 8;
    canvasCtx.strokeStyle = strokeColor;
    canvasCtx.fillStyle = strokeColor;
    canvasCtx.lineWidth = prefs.arrowLineWidth || prefs.lineLineWidth || 2;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    // Preview: existing points + cursor position, with an arrowhead at the tip.
    const previewPts = [...st.splineArrowPoints, { x: snapX, y: snapY }];
    strokeSplineArrowCurve(canvasCtx, previewPts);
    if (previewPts.length >= 2) {
      const angle = splineArrowEndTangent(previewPts);
      const tip = previewPts[previewPts.length - 1];
      drawArrowheadOnCanvas(canvasCtx, tip.x, tip.y, angle, headSize, prefs.arrowEndHead || 'open');
    }

    // Draw control point markers
    canvasCtx.fillStyle = strokeColor;
    for (const pt of st.splineArrowPoints) {
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      canvasCtx.fill();
    }

    canvasCtx.restore();
    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  // Escape (GitHub #273): same finish as right-click — commit the points so far
  // (>= 2) or cancel.
  onEscape(ctx) {
    const { state: st } = ctx;
    if (!st.isDrawingSplineArrow && (!st.splineArrowPoints || st.splineArrowPoints.length === 0)) {
      return false;
    }
    _finishSplineArrow(ctx);
    return true;
  },

  onDeactivate(ctx) {
    const { state: st } = ctx;
    if (st.isDrawingSplineArrow) {
      st.splineArrowPoints = [];
      st.isDrawingSplineArrow = false;
      ctx.redraw();
    }
  },
};

function _finishSplineArrow(ctx) {
  const { state: st } = ctx;
  if (st.splineArrowPoints.length >= 2) {
    const prefs = st.preferences;
    const pts = [...st.splineArrowPoints];
    const strokeColor = prefs.arrowStrokeColor || prefs.lineStrokeColor || '#000000';
    const ann = ctx.createAnnotation({
      type: 'splineArrow',
      page: getActiveDocument()?.currentPage || 1,
      points: pts,
      color: strokeColor,
      strokeColor,
      lineWidth: prefs.arrowLineWidth || prefs.lineLineWidth || 2,
      borderStyle: prefs.arrowBorderStyle || 'solid',
      startHead: prefs.splineArrowStartHead || 'none',
      endHead: prefs.arrowEndHead || 'open',
      headSize: prefs.arrowHeadSize || 8,
      opacity: (prefs.arrowOpacity ?? 100) / 100,
    });
    const doc = getActiveDocument();
    if (doc) {
      doc.annotations.push(ann);
      doc.selectedAnnotations = [ann];
      doc.selectedAnnotation = ann;
    }
    ctx.recordAdd(ann);
  }
  st.splineArrowPoints = [];
  st.isDrawingSplineArrow = false;
  ctx.redraw();
  import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _drawHoverSnap(ctx, x, y) {
  paintHoverSnap(ctx, x, y);
}
