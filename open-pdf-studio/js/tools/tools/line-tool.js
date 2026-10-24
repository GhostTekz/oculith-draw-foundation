/**
 * Line tool — handles line, arrow
 * Click-click: first click sets start, second click sets end.
 * Press-drag-release also works: releasing at least LINE_DRAG_COMMIT_PX
 * screen pixels away from the start point ends the line there.
 */
import { state, getActiveDocument } from '../../core/state.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  applyToEndpoint,
  typeLengthHasBuffer,
} from '../type-length-input.js';
import { activeDrawingToolPreset } from '../tool-chest-presets.js';
import { paintHoverSnap } from '../pointer-snap.js';

// Internal state for click-click line drawing.
// lockDirX/Y: direction anchor frozen at the moment the user STARTS typing a
// length — typically right after Shift straightened the preview. While the
// type-buffer is non-empty the segment direction stays locked to this anchor
// (mouse movement no longer changes it); cleared when the buffer empties or
// the segment commits/cancels.
const _lineState = {
  startX: 0, startY: 0, drawing: false,
  lastCursorX: 0, lastCursorY: 0,
  lockDirX: null, lockDirY: null,
  // True between the pointerdown that set the start point and the next
  // pointerup: a release far enough away is a drag-to-create (the external editor accepts
  // both click-click and press-drag-release for Line/Arrow).
  pressed: false,
};

// Minimum drag distance, in screen pixels, before a release ends the line.
export const LINE_DRAG_COMMIT_PX = 5;

export const lineTool = {
  name: 'line',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) {
      // Right-click cancels (shared routine, also used by Escape)
      _cancelLineDrawing(ctx);
      return;
    }

    if (activeDrawingToolPreset(state.currentTool)) {
      if (_lineState.drawing) _cancelLineDrawing(ctx);
      const tool = state.currentTool;
      const ann = ctx.createAnnotationFromTool(tool, state.startX, state.startY, state.startX, state.startY, e);
      if (ann) {
        const doc = state.documents[state.activeDocumentIndex];
        if (doc) doc.annotations.push(ann);
        ctx.recordAdd(ann);
      }
      state.lastSnapResult = null;
      state.isDrawing = false;
      ctx.redraw();
      import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
      return true;
    }

    if (!_lineState.drawing) {
      // First click: record start point
      _lineState.startX = state.startX;
      _lineState.startY = state.startY;
      _lineState.lastCursorX = state.startX;
      _lineState.lastCursorY = state.startY;
      _lineState.drawing = true;
      _lineState.pressed = true;
      state.isDrawing = true;
      // Activate type-length capture: typing digits now will lock segment length
      enterTypeLengthMode(_lineState.startX, _lineState.startY);
      state._typeLengthCommit = (length) => _commitLine(ctx, e);
      // Polar tracking anchor (used by snap-engine when polar is on)
      if (ctx.setPolarAnchor) ctx.setPolarAnchor(_lineState.startX, _lineState.startY, ctx.pageNum);
    } else {
      // Second click: create the line annotation
      let endX, endY;
      if (typeLengthHasBuffer()) {
        // Honor typed length along the PREVIEW direction (includes snap +
        // Shift angle-straightening) — what you saw is what you get.
        const dirX = _lineState.lastCursorX ?? ctx.x;
        const dirY = _lineState.lastCursorY ?? ctx.y;
        const ep = applyToEndpoint(_lineState.startX, _lineState.startY, dirX, dirY);
        endX = ep.x;
        endY = ep.y;
      } else {
        const rawX = ctx.x, rawY = ctx.y;
        const endSnap = ctx.snap(rawX, rawY);
        endX = endSnap.snapped ? endSnap.x : ctx.snapToGrid(rawX);
        endY = endSnap.snapped ? endSnap.y : ctx.snapToGrid(rawY);
      }

      _commitLineAt(ctx, e, endX, endY);
    }
  },

  onPointerMove(ctx, e) {
    const { x, y } = ctx;
    if (!_lineState.drawing) {
      // Hover snap indicator
      _drawHoverSnap(ctx, x, y);
      return;
    }

    // Temporarily set state.startX/Y to the saved first-click position
    // so drawShapePreview uses the correct origin
    const savedStartX = state.startX;
    const savedStartY = state.startY;
    state.startX = _lineState.startX;
    state.startY = _lineState.startY;

    // Snap cursor position for preview
    const snap = ctx.snap(x, y);
    let previewX = snap.snapped ? snap.x : x;
    let previewY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    // Shift = angle snap (straighten). Applied to the preview AND remembered
    // as the type-length direction so a typed measurement commits along the
    // straightened direction — not along the raw diagonal cursor.
    const prefs = state.preferences;
    if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap && ctx.snapAngle) {
      const dx = previewX - _lineState.startX;
      const dy = previewY - _lineState.startY;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snappedA = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
      previewX = _lineState.startX + len * Math.cos(snappedA);
      previewY = _lineState.startY + len * Math.sin(snappedA);
    }

    // Direction lock while typing: the FIRST buffered character freezes the
    // current (possibly Shift-straightened) direction; as long as the buffer
    // is non-empty the segment keeps that direction no matter where the
    // mouse moves. Releasing Shift to type digits therefore keeps the line
    // horizontal/vertical exactly as previewed.
    if (typeLengthHasBuffer()) {
      if (_lineState.lockDirX == null) {
        _lineState.lockDirX = _lineState.lastCursorX;
        _lineState.lockDirY = _lineState.lastCursorY;
      }
      previewX = _lineState.lockDirX;
      previewY = _lineState.lockDirY;
    } else {
      _lineState.lockDirX = null;
      _lineState.lockDirY = null;
    }

    // Remember the SNAPPED cursor for type-length direction on Enter-commit.
    _lineState.lastCursorX = previewX;
    _lineState.lastCursorY = previewY;
    // If user has typed a length, lock endpoint distance to the typed value
    // ALONG THE LOCKED DIRECTION (previewX/Y holds the frozen anchor).
    if (typeLengthHasBuffer()) {
      const ep = applyToEndpoint(_lineState.startX, _lineState.startY, previewX, previewY);
      previewX = ep.x;
      previewY = ep.y;
      _lineState.lastCursorX = ep.x;
      _lineState.lastCursorY = ep.y;
      state.lastSnapResult = null;
    }
    ctx.drawShapePreview(previewX, previewY, e);

    // Restore state.startX/Y (the dispatcher may have overwritten them)
    state.startX = savedStartX;
    state.startY = savedStartY;
  },

  onPointerUp(ctx, e) {
    if (activeDrawingToolPreset(state.currentTool)) return true;
    const wasPressed = _lineState.pressed;
    _lineState.pressed = false;
    if (!_lineState.drawing) return false;
    // Drag-to-create: the button went down on the start point and comes up
    // somewhere else, so the release is the end point. A release on (or near)
    // the start point keeps click-click mode: the next click ends the line.
    // A typed length keeps waiting for Enter or the next click.
    if (wasPressed && !typeLengthHasBuffer()) {
      const scale = ctx.scale || 1;
      const dx = ctx.x - _lineState.startX;
      const dy = ctx.y - _lineState.startY;
      if (Math.hypot(dx, dy) * scale >= LINE_DRAG_COMMIT_PX) {
        // End where the preview showed it (snap and Shift straightening).
        _commitLineAt(ctx, e, _lineState.lastCursorX, _lineState.lastCursorY);
        return true;
      }
    }
    // Click-click mode: everything else happens in pointerDown. Return true
    // so the dispatcher doesn't call _finishDrawing.
    return true;
  },

  // Escape (GitHub #273): zelfde annulering als rechtermuisklik — het
  // lopende segment (en een eventuele doorloop-ketting) stopt; al
  // gecommitte segmenten blijven staan. De keyboard-handler schakelt
  // daarna naar de selectietool.
  onEscape(ctx) {
    return _cancelLineDrawing(ctx);
  },

  onDeactivate(ctx) {
    _lineState.pressed = false;
    _lineState.lockDirX = null;
    _lineState.lockDirY = null;
    if (_lineState.drawing) {
      _lineState.drawing = false;
      state.isDrawing = false;
      ctx.redraw();
    }
    exitTypeLengthMode();
    state._typeLengthCommit = null;
    if (ctx.clearPolarAnchor) ctx.clearPolarAnchor();
  },
};

// Gedeelde annuleerroutine: rechtermuisklik én Escape beëindigen het lopende
// segment / de doorloop-ketting op precies dezelfde manier. Retourneert true
// als er daadwerkelijk een tekening actief was.
function _cancelLineDrawing(ctx) {
  _lineState.pressed = false;
  if (!_lineState.drawing) return false;
  _lineState.drawing = false;
  _lineState.lockDirX = null;
  _lineState.lockDirY = null;
  state.isDrawing = false;
  exitTypeLengthMode();
  state._typeLengthCommit = null;
  if (ctx.clearPolarAnchor) ctx.clearPolarAnchor();
  ctx.redraw();
  return true;
}

function _commitLine(ctx, e) {
  // Commit using last known cursor direction + buffered length
  const ep = applyToEndpoint(
    _lineState.startX,
    _lineState.startY,
    _lineState.lastCursorX,
    _lineState.lastCursorY,
  );
  _commitLineAt(ctx, e, ep.x, ep.y);
}

function _commitLineAt(ctx, e, endX, endY) {
  state.lastSnapResult = null;
  state.isDrawing = false;
  _lineState.drawing = false;
  _lineState.lockDirX = null;
  _lineState.lockDirY = null;
  if (ctx.clearPolarAnchor) ctx.clearPolarAnchor();

  const tool = state.currentTool;
  const ann = ctx.createAnnotationFromTool(tool, _lineState.startX, _lineState.startY, endX, endY, e);
  if (ann) {
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) doc.annotations.push(ann);
    ctx.recordAdd(ann);
  }
  exitTypeLengthMode();
  state._typeLengthCommit = null;

  // CHAIN-tekenen: het zojuist vastgelegde eindpunt wordt meteen het beginpunt
  // van het volgende segment, zodat je in één doorlopende flow doortekent.
  // - WALLS doen dit altijd (de renderer verstekt de gedeelde hoek).
  // - LIJNEN doen dit wanneer de voorkeur 'doorgaan' (aaneengesloten lijnen)
  //   aanstaat — het 'continue'-vinkje bij het lijn-gereedschap.
  // Rechtsklik / Esc / tool-wissel beëindigt de reeks (de cancel-paden in
  // onPointerDown / onDeactivate).
  const chainThisSegment =
    tool === 'wall' ||
    tool === 'betonbalk' ||
    (tool === 'line' && state.preferences?.lineContinue === true);
  if (chainThisSegment && ann) {
    _lineState.startX = endX;
    _lineState.startY = endY;
    _lineState.lastCursorX = endX;
    _lineState.lastCursorY = endY;
    _lineState.drawing = true;
    state.isDrawing = true;
    enterTypeLengthMode(endX, endY);
    state._typeLengthCommit = () => _commitLine(ctx, e);
    if (ctx.setPolarAnchor) ctx.setPolarAnchor(endX, endY, ctx.pageNum);
    ctx.redraw();
    return;
  }

  ctx.redraw();

  // Auto-reset to select tool
  import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _drawHoverSnap(ctx, x, y) {
  paintHoverSnap(ctx, x, y);
}
