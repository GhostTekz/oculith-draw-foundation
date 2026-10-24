/**
 * the external editor (an external publisher) markup tools that the app did not have yet:
 *   typewriter  W        click: borderless text that does not wrap
 *                        (FreeText /IT /FreeTextTypewriter, saver/typemachine.js)
 *   hyperlink   Shift+H  drag a rectangle, then a URL or page (PDF /Link,
 *                        saver/hyperlink-dict.js)
 *   flag        Shift+F  click: a small flag note (/Text /Name /Flag)
 *   snapshot    G        drag a rectangle: high-res capture to the clipboard,
 *                        Ctrl+V places it as an image (tools/screenshot.js)
 */
import { applyToolTransform } from '../tool-context.js';
import { weergaveVectorNaarPagina } from '../../pdf/weergave-ruimte.js';
import { isKlikSleep } from '../../annotations/minimummaat.js';
import { getActiveDocument } from '../../core/state.js';
import { activeDrawingToolPreset, applyActiveToolPreset, finishToolPresetPlacement } from '../tool-chest-presets.js';

const revertToSelect = () =>
  import('../manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());

function pageOf(ctx) {
  return ctx.pageNum || getActiveDocument()?.currentPage || 1;
}

/** Normalised page-space rectangle between two points. */
export function dragRect(sx, sy, ex, ey) {
  return { x: Math.min(sx, ex), y: Math.min(sy, ey), width: Math.abs(ex - sx), height: Math.abs(ey - sy) };
}

function previewRect(ctx, rect, color) {
  ctx.redraw();
  const c = ctx.canvasCtx;
  if (!c) return;
  c.save();
  applyToolTransform(c);
  c.setLineDash([5 / (ctx.scale || 1), 3 / (ctx.scale || 1)]);
  c.lineWidth = 1 / (ctx.scale || 1);
  c.strokeStyle = color;
  c.strokeRect(rect.x, rect.y, rect.width, rect.height);
  c.restore();
}

// Drag a rectangle (or click for `clickSize` on screen, if given) and hand it
// to `done(ctx, rect, page, e)`.
function rectangleTool(name, { cursor = 'crosshair', color, clickSize = null, done }) {
  let page = 1;
  return {
    name,
    cursor,
    onPointerDown(ctx, e) {
      if (e.button !== 0) return;
      ctx.state.isDrawing = true;
      page = pageOf(ctx);
    },
    onPointerMove(ctx) {
      const { state } = ctx;
      if (!state.isDrawing) return;
      previewRect(ctx, dragRect(state.startX, state.startY, ctx.x, ctx.y), color);
    },
    onPointerUp(ctx, e) {
      const { state } = ctx;
      if (!state.isDrawing) return false;
      state.isDrawing = false;
      let endX = ctx.x, endY = ctx.y;
      if (isKlikSleep(Math.abs(endX - state.startX), Math.abs(endY - state.startY), ctx.scale)) {
        if (!clickSize) { ctx.redraw(); return true; }
        const naar = weergaveVectorNaarPagina(clickSize[0], clickSize[1]);
        endX = state.startX + naar.x;
        endY = state.startY + naar.y;
      }
      ctx.redraw();
      done(ctx, dragRect(state.startX, state.startY, endX, endY), page, e);
      return true;
    },
    onEscape(ctx) {
      if (!ctx.state.isDrawing) return false;
      ctx.state.isDrawing = false;
      ctx.redraw();
      return true;
    },
    onDeactivate(ctx) {
      ctx.state.isDrawing = false;
    },
  };
}

function addAndSelect(ctx, ann) {
  const doc = getActiveDocument();
  if (!doc || !ann) return;
  doc.annotations.push(ann);
  ctx.recordAdd(ann);
  doc.selectedAnnotations = [ann];
  doc.selectedAnnotation = ann;
  ctx.redraw();
  ctx.showProperties(ann);
}

export const typewriterTool = {
  name: 'typewriter',
  cursor: 'text',
  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    ctx.state.isDrawing = true;
  },
  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;
    const fontSize = state.preferences?.typewriterFontSize || state.preferences?.textboxFontSize || 12;
    // One line, a little wider than the first words: the saver widens the
    // box to its longest line (typemachineVak), the canvas does not clip.
    const naar = weergaveVectorNaarPagina(120, Math.ceil(fontSize * 1.6) + 4);
    const ann = ctx.createAnnotationFromTool('typewriter', state.startX, state.startY,
      state.startX + naar.x, state.startY + naar.y, e);
    if (!ann) return true;
    ann.page = pageOf(ctx);
    addAndSelect(ctx, ann);
    // A Drawing Mode typewriter tool with saved text places that text.
    if (!activeDrawingToolPreset('typewriter')?.text) ctx.startTextEditing(ann);
    revertToSelect();
    return true;
  },
  onDeactivate(ctx) {
    ctx.state.isDrawing = false;
  },
};

export const hyperlinkTool = rectangleTool('hyperlink', {
  color: '#2563eb',
  clickSize: [120, 24],
  done(ctx, rect, page, e) {
    const create = ({ url, page: targetPage }) => {
      const ann = ctx.createAnnotationFromTool('hyperlink', rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, e);
      if (!ann) return;
      ann.page = page;
      ann.linkUrl = url || '';
      ann.linkPage = url ? null : targetPage;
      addAndSelect(ctx, ann);
      revertToSelect();
    };
    import('../../bridge.js').then(m => m.openDialog('hyperlink', { onOk: create }));
  },
});

export const flagTool = {
  name: 'flag',
  cursor: 'crosshair',
  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    ctx.state.isDrawing = true;
  },
  onPointerUp(ctx) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;
    // A Tool Chest flag tool supplies colour (and in Drawing Mode its size).
    const ann = ctx.createAnnotation(applyActiveToolPreset('flag', {
      type: 'comment',
      page: pageOf(ctx),
      x: state.startX,
      y: state.startY,
      width: 24,
      height: 24,
      text: '',
      icon: 'flag',
      color: state.preferences?.flagColor || '#dc2626',
      fillColor: state.preferences?.flagColor || '#dc2626',
      popupOpen: false,
    }, state.startX, state.startY));
    finishToolPresetPlacement(ann, getActiveDocument());
    addAndSelect(ctx, ann);
    revertToSelect();
    return true;
  },
  onDeactivate(ctx) {
    ctx.state.isDrawing = false;
  },
};

export const snapshotTool = rectangleTool('snapshot', {
  color: '#0ea5e9',
  done(ctx, rect, page) {
    import('../screenshot.js')
      .then(m => m.snapshotRegion(page, rect))
      .then(() => revertToSelect());
  },
});
