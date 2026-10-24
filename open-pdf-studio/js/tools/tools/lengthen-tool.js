// Lengthen — click-driven CAD tool that changes a straight line's length while
// keeping its direction. Two clicks:
//   1. Click a line near the END you want to move (the nearer endpoint is
//      chosen). The line is selected.
//   2. Click a new position — the chosen endpoint moves to that point's
//      projection onto the line's own (infinite) direction, so the line grows
//      or shrinks along its axis without changing angle.
//
// Interaction mirrors extend-tool / trim-tool (no drag preview). One undo step
// (recordModify).

import { getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify } from '../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';

function _redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function _isLine(ann) {
  return ann && ann.startX !== undefined && ann.endX !== undefined &&
    (ann.type === 'line' || ann.type === 'arrow');
}

// Project point p onto the infinite line through a→b.
function _project(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { x: a.x, y: a.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

const _state = { line: null, movingEnd: null }; // movingEnd: 'start' | 'end'

export const lengthenTool = {
  name: 'lengthen',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    const { x, y } = ctx;

    if (!_state.line) {
      const clicked = ctx.findAnnotationAt(x, y);
      if (!_isLine(clicked)) return;
      const dStart = Math.hypot(x - clicked.startX, y - clicked.startY);
      const dEnd = Math.hypot(x - clicked.endX, y - clicked.endY);
      _state.line = clicked;
      _state.movingEnd = dStart <= dEnd ? 'start' : 'end';
      const doc = getActiveDocument();
      if (doc) { doc.selectedAnnotations = [clicked]; doc.selectedAnnotation = clicked; }
      _redraw();
      return;
    }

    const line = _state.line;
    // The fixed endpoint anchors the direction; the moving endpoint slides.
    const anchor = _state.movingEnd === 'start'
      ? { x: line.endX, y: line.endY }
      : { x: line.startX, y: line.startY };
    const dirEnd = _state.movingEnd === 'start'
      ? { x: line.startX, y: line.startY }
      : { x: line.endX, y: line.endY };
    const np = _project({ x, y }, anchor, dirEnd);

    // Reject degenerate results (would collapse the line onto the anchor).
    if (Math.hypot(np.x - anchor.x, np.y - anchor.y) < 1e-3) { _reset(); return; }

    const oldState = cloneAnnotation(line);
    if (_state.movingEnd === 'start') { line.startX = np.x; line.startY = np.y; }
    else { line.endX = np.x; line.endY = np.y; }
    line.modifiedAt = new Date().toISOString();
    recordModify(line.id, oldState, line);

    _reset();
    _redraw();
    import('../../tools/manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onDeactivate() { _reset(); },
};

function _reset() {
  _state.line = null;
  _state.movingEnd = null;
}
