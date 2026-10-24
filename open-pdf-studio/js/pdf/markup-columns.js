import { readMarkupTextColumn, readMarkupSecondTextColumn } from './markup-text-column.js';
import { readMarkupChoiceColumn } from './markup-choice-column.js';
import { readMarkupSecondChoiceColumn } from './markup-second-choice-column.js';
import { readMarkupNumberColumn } from './markup-number-column.js';
import { readMarkupSecondNumberColumn } from './markup-second-number-column.js';
import { readMarkupCheckmarkColumn } from './markup-checkmark-column.js';
import { readMarkupFormulaColumn } from './markup-formula-column.js';
import { readMarkupStatusSet } from './markup-status-set.js';
import { readFormulaCaptions } from './formula-captions-pdf.js';

/** Wait for source metadata before editing a column or exporting a summary. */
export async function ensureMarkupColumnsReady(doc) {
  if (!doc) return;
  const source = doc._sharedPdfLibDoc || await doc._sharedPdfLibDocPromise;
  if (!source) return;
  if (!doc.markupTextColumnName) doc.markupTextColumnName = readMarkupTextColumn(source);
  if (!doc.markupTextColumn2Name) doc.markupTextColumn2Name = readMarkupSecondTextColumn(source);
  if (!doc.markupChoiceColumn) doc.markupChoiceColumn = readMarkupChoiceColumn(source);
  if (!doc.markupChoiceColumn2) doc.markupChoiceColumn2 = readMarkupSecondChoiceColumn(source);
  if (!doc.markupNumberColumn) doc.markupNumberColumn = readMarkupNumberColumn(source);
  if (!doc.markupNumberColumn2) doc.markupNumberColumn2 = readMarkupSecondNumberColumn(source);
  if (!doc.markupCheckmarkColumn) doc.markupCheckmarkColumn = readMarkupCheckmarkColumn(source);
  if (!doc.markupFormulaColumn) doc.markupFormulaColumn = readMarkupFormulaColumn(source);
  if (doc.formulaCaptions == null) doc.formulaCaptions = readFormulaCaptions(source);
  if (!doc.markupStatusSet && doc.markupStatusSet !== false) doc.markupStatusSet = readMarkupStatusSet(source);
}
