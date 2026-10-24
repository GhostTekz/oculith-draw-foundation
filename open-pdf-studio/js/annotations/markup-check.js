// "Check" on the markup context menu (the external editor): ticks the Checkmark column of
// the selected markups. A document without a Checkmark column gets one named
// "Checkmark" (the external editor column name), so the value saves with the PDF
// (/OPS_MarkupCheckmarkValue, see pdf/markup-checkmark-column.js).

import { CHECKMARK_SCHEMA_VERSION, checkmarkColumn, checkmarkValue } from './custom-checkmark-column.js';
import { cloneAnnotation } from './factory.js';
import { recordBulkModify, recordModify } from '../core/undo-manager.js';

const COLUMN_NAMES = ['Checkmark', 'Check', 'Checked'];

/** The Checkmark column to use: the document's, or a new one. null if no name is free. */
export function checkColumnFor(doc) {
  const existing = checkmarkColumn(doc?.markupCheckmarkColumn);
  if (existing) return { definition: existing, created: false };
  const taken = new Set([doc?.markupTextColumnName, doc?.markupTextColumn2Name, doc?.markupChoiceColumn?.name,
    doc?.markupChoiceColumn2?.name, doc?.markupNumberColumn?.name, doc?.markupNumberColumn2?.name,
    doc?.markupFormulaColumn?.name].filter(name => typeof name === 'string').map(name => name.toLocaleLowerCase()));
  for (const name of COLUMN_NAMES) {
    if (taken.has(name.toLocaleLowerCase())) continue;
    const definition = checkmarkColumn({ version: CHECKMARK_SCHEMA_VERSION, name });
    if (definition) return { definition, created: true };
  }
  return null;
}

export function isMarkupChecked(annotation) {
  return checkmarkValue(annotation?.markupCheckmarkValue) === 'checked';
}

/** Toggle target: all checked → unchecked, otherwise checked. */
export function nextCheckValue(annotations) {
  return annotations.length > 0 && annotations.every(isMarkupChecked) ? 'unchecked' : 'checked';
}

/**
 * Toggle Check on markups (locked and read-only markups are left alone), as
 * one undo step. `ready` waits for the column definitions in the PDF.
 * @returns {Promise<{ value: string, count: number }|null>}
 */
export async function toggleMarkupCheck(doc, annotations, { ready } = {}) {
  if (!doc) return null;
  if (ready) {
    try { await ready(doc); } catch { /* the document's own columns still apply */ }
  }
  const column = checkColumnFor(doc);
  if (!column) return null;
  const targets = (annotations || []).filter(a => a && !a.locked && !a.readOnly);
  if (!targets.length) return null;
  if (column.created) {
    doc.markupCheckmarkColumn = column.definition;
    doc.modified = true;
    doc.savedUndoStackLength = -1;
  }
  const value = nextCheckValue(targets);
  const before = targets.map(cloneAnnotation);
  const now = new Date().toISOString();
  for (const annotation of targets) {
    annotation.markupCheckmarkValue = value;
    annotation.modifiedAt = now;
  }
  if (targets.length === 1) recordModify(targets[0].id, before[0], targets[0]);
  else recordBulkModify(targets, before);
  return { value, count: targets.length };
}
