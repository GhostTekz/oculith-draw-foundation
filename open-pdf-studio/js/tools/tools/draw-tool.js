import { applyToolTransform } from '../tool-context.js';
import { voegPenPuntenToe } from './pen-punten.js';

/**
 * Freehand draw tool
 */
export const drawTool = {
  name: 'draw',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    const { x, y, state } = ctx;
    state.isDrawing = true;
    state.currentPath = [{ x, y }];
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx } = ctx;
    if (!state.isDrawing) return;

    // Every position since the previous frame, then this one (pen-punten.js).
    const vanaf = voegPenPuntenToe(state.currentPath, ctx.penTussenpunten, { x, y }, ctx.scale);

    // Incremental draw — only the new segment(s)
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    const prefs = state.preferences;
    // Ribbon picker values win over prefs so the live preview matches what
    // will be saved (annotation-creators uses the same priority order).
    canvasCtx.strokeStyle = ctx.getColorPickerValue() || prefs.drawStrokeColor || '#000000';
    canvasCtx.lineWidth = ctx.getLineWidthValue() || prefs.drawLineWidth || 2;
    canvasCtx.globalAlpha = (prefs.drawOpacity || 100) / 100;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.beginPath();
    canvasCtx.moveTo(state.currentPath[vanaf].x, state.currentPath[vanaf].y);
    for (let i = vanaf + 1; i < state.currentPath.length; i++) canvasCtx.lineTo(state.currentPath[i].x, state.currentPath[i].y);
    canvasCtx.stroke();
    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;

    const ann = ctx.createAnnotationFromTool('draw', state.startX, state.startY, ctx.x, ctx.y, e);
    if (ann) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
    ctx.redraw();

    // Auto-reset to select tool
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());

    return true;
  },
};
