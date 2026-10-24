// Radius & Diameter dimension tools. Two clicks each produce a measureDistance
// annotation whose label is prefixed so it reads as a radius ("R …") or a
// diameter ("⌀ …"). They reuse the existing measureDistance annotation type,
// its renderer (drawDimension) and the scale-aware distance calc, so nothing
// new is needed in the renderer or the saver.
//
//   * Radius   — click the CENTRE, then the RIM. The dimension runs centre→rim
//                with a single arrowhead at the rim.
//   * Diameter — click one side, then the opposite side. Arrowheads both ends.

import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';

// Shared 2-click flow. `kind` selects the label prefix + arrow styling.
function makeDimTool(name, kind) {
  const st = { p1: null };

  function labelFor(ctx, dist) {
    const num = ctx.formatMeasurement(dist);
    return kind === 'radius' ? `R ${num}` : `⌀ ${num}`;
  }

  return {
    name,
    cursor: 'crosshair',

    onPointerDown(ctx, e) {
      if (e.button === 2) { st.p1 = null; ctx.redraw(); return; }
      if (e.button !== 0) return;
      const { x, y } = ctx;
      const snap = ctx.snap(x, y);
      const px = snap.snapped ? snap.x : x;
      const py = snap.snapped ? snap.y : y;

      if (!st.p1) {
        st.p1 = { x: px, y: py };
        return;
      }

      const p1 = st.p1;
      const p2 = { x: px, y: py };
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 3 / ctx.scale) return;

      const page = getActiveDocument()?.currentPage || 1;
      const dist = ctx.calculateDistance(p1.x, p1.y, p2.x, p2.y, page);
      const prefs = ctx.prefs;
      const ann = ctx.createAnnotation({
        type: 'measureDistance',
        page,
        startX: p1.x, startY: p1.y,
        endX: p2.x, endY: p2.y,
        startHead: kind === 'radius' ? 'none' : 'closed',
        endHead: 'closed',
        headSize: prefs.measureDistHeadSize || 12,
        color: prefs.measureDistStrokeColor,
        strokeColor: prefs.measureDistStrokeColor,
        lineWidth: prefs.measureDistLineWidth,
        fontSize: prefs.measureDistFontSize || undefined,
        dimExtension: false,
        opacity: (prefs.measureDistOpacity || 100) / 100,
        measureText: labelFor(ctx, dist),
        measureValue: dist.value,
        measureUnit: dist.unit,
        measurePixels: dist.pixels,
      });
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
      st.p1 = null;
      ctx.redraw();
      import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
    },

    onPointerMove(ctx, e) {
      const { x, y, canvasCtx } = ctx;
      const snap = ctx.snap(x, y);
      const px = snap.snapped ? snap.x : x;
      const py = snap.snapped ? snap.y : y;
      if (!st.p1) {
        if (snap.snapped) { ctx.redraw(); ctx.drawSnapIndicator(snap); }
        return;
      }
      const page = getActiveDocument()?.currentPage || 1;
      const dist = ctx.calculateDistance(st.p1.x, st.p1.y, px, py, page);
      ctx.redraw();
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = ctx.prefs.measureDistStrokeColor || '#FF0000';
      canvasCtx.lineWidth = ctx.prefs.measureDistLineWidth || 1;
      ctx.drawDimension(canvasCtx, {
        startX: st.p1.x, startY: st.p1.y, endX: px, endY: py,
        startHead: kind === 'radius' ? 'none' : 'closed',
        endHead: 'closed',
        headSize: ctx.prefs.measureDistHeadSize || 12,
        color: ctx.prefs.measureDistStrokeColor || '#FF0000',
        measureText: labelFor(ctx, dist),
      });
      canvasCtx.restore();
      if (snap.snapped) ctx.drawSnapIndicator(snap);
    },

    onEscape(ctx) {
      if (st.p1) { st.p1 = null; ctx.redraw(); return true; }
      return false;
    },

    onDeactivate(ctx) {
      st.p1 = null;
      ctx.redraw();
    },
  };
}

export const radiusTool = makeDimTool('radius', 'radius');
export const diameterTool = makeDimTool('diameter', 'diameter');
