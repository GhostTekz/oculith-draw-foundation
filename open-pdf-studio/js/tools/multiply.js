/**
 * Multiply (the external editor): copies of the selected markups in a row, each one offset
 * further by (dx, dy). Offsets are in page points along the screen
 * directions (right and down are positive), so a rotated view (#200) copies
 * the way the user sees it. All copies are one undo step (bulkAdd).
 */
import { relinkCopiedGroups } from '../annotations/markup-groups.js';
import { getActiveDocument, getSelectionBounds } from '../core/state.js';
import { recordBulkAdd } from '../core/undo-manager.js';
import { applyMove } from '../annotations/transforms.js';
import { isTextAnchored } from '../annotations/corrections/model.js';
import { multiplyOffsets } from '../annotations/format-painter.js';
import { weergaveVectorNaarPagina } from '../pdf/weergave-ruimte.js';
import { getMeasureScale } from '../annotations/measurement.js';
import { cloneForInsert } from './edit-ops.js';
import { isLayerEditable } from '../annotations/annotatie-lagen.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';

/**
 * Markups Multiply can copy: selected, unlocked, not anchored to text, and
 * not on a hidden or locked markup layer (#468).
 */
export function multiplyTargets(doc = getActiveDocument()) {
  return (doc?.selectedAnnotations || [])
    .filter(a => a && !a.locked && !isTextAnchored(a) && isLayerEditable(doc, a));
}

/**
 * Scale for the dialog: the calibrated unit at the centre of the selection,
 * or page points when the page has no calibration.
 */
export function multiplyScale(doc = getActiveDocument()) {
  const b = getSelectionBounds();
  const page = multiplyTargets(doc)[0]?.page || doc?.currentPage || 1;
  const s = b ? getMeasureScale(page, b.x + b.width / 2, b.y + b.height / 2) : getMeasureScale(page);
  return { pixelsPerUnit: s.pixelsPerUnit || 1, unit: s.unit || 'pt', calibrated: !!s.calibrated, bounds: b };
}

/**
 * Make `count` copies of the selection, copy i at i x (dx, dy) page points
 * (screen directions). Copies of a group form a new group per copy. The
 * copies become the selection. Returns the copies.
 */
export function multiplySelection({ count, dx, dy }) {
  const doc = getActiveDocument();
  const targets = multiplyTargets(doc);
  const offsets = multiplyOffsets(count, dx, dy);
  if (!doc || targets.length === 0 || offsets.length === 0) return [];
  const copies = [];
  offsets.forEach((o, i) => {
    const { x, y } = weergaveVectorNaarPagina(o.dx, o.dy, doc);
    const batch = [];
    for (const t of targets) {
      const c = cloneForInsert(t);
      applyMove(c, x, y);
      batch.push(c);
    }
    // Each copy of a group is a new group, with its name and nesting.
    relinkCopiedGroups(targets, batch, { newId: () => `grp_x${i + 1}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` });
    copies.push(...batch);
  });
  doc.annotations.push(...copies);
  recordBulkAdd(copies);
  doc.selectedAnnotations = copies;
  doc.selectedAnnotation = copies[0];
  if (doc.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
  return copies;
}
