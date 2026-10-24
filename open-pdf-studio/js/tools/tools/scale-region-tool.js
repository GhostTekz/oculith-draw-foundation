/**
 * Add Viewport tool (scaleRegion): drag a rectangle, or click two corners.
 * Shift keeps it square. Between the two, a live light-blue rectangle is
 * drawn from P1 to the cursor. Esc or right-click cancels.
 *
 * Afterwards the "Apply Scale to Viewport" dialog (scale-region) asks for
 * the name, scale and precision.
 */
import { state, getActiveDocument } from '../../core/state.js';
import { createScaleRegion, invalidateScaleRegionCache } from '../../annotations/scale-region.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { openDialog } from '../../bridge.js';
import { MIN_GEBIED_PX, schermPxNaarPt } from '../../annotations/minimummaat.js';
import { applyToolTransform } from '../tool-transform.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

// Module-level placement state — survives across pointer events.
const _placement = { firstX: null, firstY: null, dragging: false };

function _reset() {
  _placement.firstX = _placement.firstY = null;
  _placement.dragging = false;
}

/**
 * The rectangle from the first corner to (x, y); with Shift a square with
 * the larger side, growing toward the cursor.
 */
export function viewportRechthoek(x0, y0, x, y, vierkant = false) {
  let dx = x - x0;
  let dy = y - y0;
  if (vierkant) {
    const zijde = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * zijde;
    dy = (dy < 0 ? -1 : 1) * zijde;
  }
  return { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), width: Math.abs(dx), height: Math.abs(dy) };
}

// Draw the light-blue preview rectangle in app coordinates.
function _drawPreview(curX, curY, vierkant = false) {
  if (_placement.firstX === null || !annotationCtx) return;
  redraw();
  const vp = window.__pdfViewport;
  const doc = getActiveDocument();
  const ctx = annotationCtx;
  ctx.save();
  // Zelfde transform als de annotatieweergave (ook met een gedraaide weergave, #200).
  applyToolTransform(ctx);
  const r = viewportRechthoek(_placement.firstX, _placement.firstY, curX, curY, vierkant);
  ctx.strokeStyle = 'rgba(30, 120, 230, 0.85)';
  ctx.fillStyle = 'rgba(64, 156, 255, 0.10)';
  ctx.lineWidth = 1.5 / (vp?.zoom || doc?.scale || 1.5);
  ctx.setLineDash([]);
  ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  ctx.restore();
}

function _finish(ctx, e) {
  const r = viewportRechthoek(_placement.firstX, _placement.firstY, ctx.x, ctx.y, !!e?.shiftKey);
  _reset();
  ctx.redraw();

  // Zelfde ondergrens als bij het slepen aan de grepen, in SCHERMPIXELS
  // (px / zoom): ingezoomd mag een viewport kleiner zijn.
  const minPt = schermPxNaarPt(MIN_GEBIED_PX, ctx.scale);
  if (r.width < minPt || r.height < minPt) return;

  const doc = getActiveDocument();
  if (!doc) return;
  const pageNum = doc.currentPage || 1;

  // In the list (and highlighted) while the dialog is open; the dialog
  // records it on Apply or removes it on Cancel.
  const ann = createScaleRegion({
    page: pageNum,
    x: r.x, y: r.y, width: r.width, height: r.height,
    scaleString: '1:100',
    units: 'mm',
    label: '',
  });

  doc.annotations.push(ann);
  invalidateScaleRegionCache();
  redraw();

  openDialog('scale-region', { annotationId: ann.id, pageNum, isNew: true });
}

export const scaleRegionTool = {
  name: 'scaleRegion',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    // Right-click cancels in-progress placement.
    if (e.button === 2) {
      if (_placement.firstX !== null) {
        _reset();
        ctx.redraw();
        e.preventDefault?.();
      }
      return;
    }
    if (e.button !== 0) return;

    if (_placement.firstX === null) {
      _placement.firstX = ctx.x;
      _placement.firstY = ctx.y;
      _placement.dragging = true;
      _drawPreview(ctx.x, ctx.y, !!e.shiftKey);
      return;
    }

    // Second click — finalise.
    _finish(ctx, e);
  },

  // Released after a drag: finalise. A click without a drag keeps the first
  // corner and waits for the second click.
  onPointerUp(ctx, e) {
    if (_placement.firstX === null || !_placement.dragging) return false;
    _placement.dragging = false;
    const minPt = schermPxNaarPt(MIN_GEBIED_PX, ctx.scale);
    if (Math.abs(ctx.x - _placement.firstX) < minPt && Math.abs(ctx.y - _placement.firstY) < minPt) return true;
    _finish(ctx, e);
    return true;
  },

  onPointerMove(ctx, e) {
    if (_placement.firstX === null) return;
    _drawPreview(ctx.x, ctx.y, !!e?.shiftKey);
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik — lopende
  // plaatsing weggooien. De keyboard-handler schakelt daarna naar de
  // selectietool.
  onEscape(ctx) {
    if (_placement.firstX === null) return false;
    _reset();
    ctx.redraw();
    return true;
  },

  onDeactivate() {
    _reset();
  },
};
