import { state, getActiveDocument } from '../../core/state.js';
import { pathOf, trimPair } from '../../annotations/path-cross.js';
import { recordModify, beginUndoTransaction, endUndoTransaction } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _trimState = { cuttingEdge: null };

export const trimTool = {
  name: 'trim',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);
    if (!clicked || !pathOf(clicked)) return;

    if (!_trimState.cuttingEdge) {
      _trimState.cuttingEdge = clicked;
      const doc = getActiveDocument();
      if (doc) { doc.selectedAnnotations = [clicked]; doc.selectedAnnotation = clicked; }
      redrawAnnotations();
      return;
    }

    const target = clicked;
    const cutter = _trimState.cuttingEdge;
    if (target === cutter) { _trimState.cuttingEdge = null; return; }

    // Two-point lines still meet on the infinite corner. A longer path is
    // cut only where the segments actually cross.
    const cut = trimPair(target, cutter, { x, y });
    _trimState.cuttingEdge = null;
    if (!cut) return;

    beginUndoTransaction();
    recordModify(target.id, cut.oldTarget, target);
    recordModify(cutter.id, cut.oldCutter, cutter);
    endUndoTransaction();
    redrawAnnotations();
    _trimState.cuttingEdge = null;
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onDeactivate() { _trimState.cuttingEdge = null; },
};
