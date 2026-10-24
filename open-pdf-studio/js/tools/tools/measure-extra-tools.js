// plan-review measure tools on top of the base measurement tools:
//
//   measurePolylength  open polyline with total + per-segment values
//                      (the Perimeter click flow; a measurePerimeter of kind
//                      'polylength')
//   measureVolume      area x depth (the Area click flow, holes included;
//                      a measureArea of kind 'volume')
//   measureArc         3-point arc length: start, a point on the arc, end
//   measureRadius3     3-point radius: three points on a circle or arc
//
// Values, caption and persistence live in annotations/measure-extras.js; the
// annotations keep their base type so handles, transforms and the PDF form
// stay those of the base measurement.

import { state, getActiveDocument } from '../../core/state.js';
import { recordAdd } from '../../core/undo-manager.js';
import {
  densifyArc, circleFrom3Points, arcThrough3, ARC_SEGMENTS,
} from '../../annotations/measure-extras.js';
import {
  createPolylengthMeasurement, createVolumeMeasurement, createArcMeasurement, createRadius3Measurement,
} from '../measure-extra-creators.js';
import { applyToolTransform } from '../tool-context.js';
import { zetRechtopRond } from '../../pdf/weergave-ruimte.js';
import { measurePerimeterTool, measureAreaTool } from './measurement-tool.js';

// The base multi-click flows create their annotation through ctx; a context
// with these creators makes the same flow produce the extra kind.
function withKindCreators(ctx) {
  return {
    ...ctx,
    createMeasurePerimeterAnnotation: createPolylengthMeasurement,
    createMeasureAreaAnnotation: createVolumeMeasurement,
  };
}

// keyboard-handlers' Enter block only finishes the base tool names; the extra
// tools finish on Enter here (same routine as Escape / right-click).
function finishOnEnter(base, ctx, e, minPoints) {
  if (e.key !== 'Enter') return false;
  const inHoles = state.measurePhase === 'holes' && state.measureOuterPoints;
  if (!inHoles && !(state.measurePoints && state.measurePoints.length >= minPoints)) return false;
  e.preventDefault();
  base.onEscape(withKindCreators({ state, redraw: ctx.redraw, recordAdd }));
  return true;
}

function wrapMultiClick(name, base, minPoints) {
  return {
    name,
    cursor: 'crosshair',
    onPointerDown(ctx, e) { base.onPointerDown(withKindCreators(ctx), e); },
    onPointerMove(ctx, e) { base.onPointerMove(withKindCreators(ctx), e); },
    onKeyDown(ctx, e) {
      if (finishOnEnter(base, ctx, e, minPoints)) return;
      if (base.onKeyDown) base.onKeyDown(ctx, e);
    },
    onWheel(ctx, e) { if (base.onWheel) base.onWheel(ctx, e); },
    onEscape(ctx, e) { return base.onEscape(withKindCreators(ctx), e); },
    onDeactivate(ctx) { if (base.onDeactivate) base.onDeactivate(withKindCreators(ctx)); },
  };
}

export const measurePolylengthTool = wrapMultiClick('measurePolylength', measurePerimeterTool, 2);
export const measureVolumeTool = wrapMultiClick('measureVolume', measureAreaTool, 3);

// ── 3-point tools ──

function snapped(ctx) {
  const s = ctx.snap(ctx.x, ctx.y);
  if (s.snapped) state.lastSnapResult = s; else state.lastSnapResult = null;
  return { x: s.snapped ? s.x : ctx.x, y: s.snapped ? s.y : ctx.y, snap: s };
}

function finish(ann) {
  const doc = getActiveDocument();
  if (doc) doc.annotations.push(ann);
  recordAdd(ann);
  import('../manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function makeThreePointTool(name, kind) {
  const st = { pts: [] };
  const color = () => state.preferences?.measurePerimStrokeColor || '#FF0000';

  function preview(ctx, cursor) {
    const { canvasCtx } = ctx;
    ctx.redraw();
    if (!canvasCtx) return;
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = color();
    canvasCtx.lineWidth = state.preferences?.measurePerimLineWidth || 1;
    const [a, b] = st.pts;
    let label = '';
    if (st.pts.length === 1) {
      ctx.drawMeasurePerimeterShape(canvasCtx, [a, cursor], color(), 'dashed');
    } else if (kind === 'arc') {
      const pts = densifyArc(a, b, cursor, ARC_SEGMENTS);
      if (pts) {
        ctx.drawMeasurePerimeterShape(canvasCtx, pts, color(), 'solid');
        const arc = arcThrough3(a, b, cursor);
        const page = getActiveDocument()?.currentPage || 1;
        const chord = ctx.calculateDistance(a.x, a.y, cursor.x, cursor.y, page);
        const chordPx = Math.hypot(cursor.x - a.x, cursor.y - a.y) || 1;
        label = ctx.formatMeasurement({ ...chord, value: chord.value * (arc.r * Math.abs(arc.sweep)) / chordPx });
      } else {
        ctx.drawMeasurePerimeterShape(canvasCtx, [a, b, cursor], color(), 'dashed');
      }
    } else {
      const circle = circleFrom3Points(a, b, cursor);
      if (circle) {
        canvasCtx.setLineDash([4, 2]);
        canvasCtx.beginPath();
        canvasCtx.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
        canvasCtx.stroke();
        canvasCtx.setLineDash([]);
        ctx.drawMeasurePerimeterShape(canvasCtx, [{ x: circle.cx, y: circle.cy }, cursor], color(), 'solid');
        const page = getActiveDocument()?.currentPage || 1;
        label = 'R ' + ctx.formatMeasurement(ctx.calculateDistance(circle.cx, circle.cy, cursor.x, cursor.y, page));
      }
    }
    for (const p of st.pts) {
      canvasCtx.beginPath();
      canvasCtx.arc(p.x, p.y, 2.5 / (ctx.scale || 1), 0, Math.PI * 2);
      canvasCtx.fillStyle = color();
      canvasCtx.fill();
    }
    if (label) {
      canvasCtx.save();
      zetRechtopRond(canvasCtx, cursor.x, cursor.y);
      canvasCtx.font = '11px Arial';
      canvasCtx.fillStyle = color();
      canvasCtx.fillText(label, cursor.x + 8, cursor.y - 4);
      canvasCtx.restore();
    }
    canvasCtx.restore();
  }

  return {
    name,
    cursor: 'crosshair',
    onPointerDown(ctx, e) {
      if (e.button === 2) { st.pts = []; ctx.redraw(); return; }
      if (e.button !== 0 || e.detail === 2) return;
      const p = snapped(ctx);
      const pt = { x: p.x, y: p.y };
      const last = st.pts[st.pts.length - 1];
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 3 / (ctx.scale || 1)) return;
      st.pts.push(pt);
      if (st.pts.length < 3) { ctx.redraw(); return; }
      const [a, b, c] = st.pts;
      st.pts = [];
      const ann = kind === 'arc' ? createArcMeasurement(a, b, c) : createRadius3Measurement(a, b, c);
      if (ann) finish(ann);
      ctx.redraw();
    },
    onPointerMove(ctx) {
      const p = snapped(ctx);
      if (!st.pts.length) {
        ctx.redraw();
        if (p.snap.snapped) ctx.drawSnapIndicator(p.snap);
        return;
      }
      preview(ctx, { x: p.x, y: p.y });
      if (p.snap.snapped) ctx.drawSnapIndicator(p.snap);
    },
    onEscape(ctx) {
      if (st.pts.length) { st.pts = []; ctx.redraw(); return true; }
      return false;
    },
    onDeactivate(ctx) { st.pts = []; ctx.redraw(); },
  };
}

export const measureArcTool = makeThreePointTool('measureArc', 'arc');
export const measureRadius3Tool = makeThreePointTool('measureRadius3', 'radius');
