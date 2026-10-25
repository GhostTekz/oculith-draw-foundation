// The Markups List columns and status set a PDF brings, from the catalog
// fields the loader read at open (pdf-lib-catalog.js). A value the user set
// meanwhile is kept.

import { readCatalogFields } from './pdf-lib-catalog.js';

/** Fill the column fields `doc` does not have yet from `catalog`. */
export function applyMarkupColumns(doc, catalog) {
  if (!doc || !catalog) return;
  if (!doc.markupTextColumnName) doc.markupTextColumnName = catalog.textColumnName;
  if (!doc.markupTextColumn2Name) doc.markupTextColumn2Name = catalog.textColumn2Name;
  if (!doc.markupChoiceColumn) doc.markupChoiceColumn = catalog.choiceColumn;
  if (!doc.markupChoiceColumn2) doc.markupChoiceColumn2 = catalog.choiceColumn2;
  if (!doc.markupNumberColumn) doc.markupNumberColumn = catalog.numberColumn;
  if (!doc.markupNumberColumn2) doc.markupNumberColumn2 = catalog.numberColumn2;
  if (!doc.markupCheckmarkColumn) doc.markupCheckmarkColumn = catalog.checkmarkColumn;
  if (!doc.markupFormulaColumn) doc.markupFormulaColumn = catalog.formulaColumn;
  if (doc.formulaCaptions == null) doc.formulaCaptions = catalog.formulaCaptions;
  if (!doc.markupStatusSet && doc.markupStatusSet !== false) doc.markupStatusSet = catalog.statusSet;
}

/** Wait for source metadata before editing a column or exporting a summary. */
export async function ensureMarkupColumnsReady(doc) {
  if (!doc) return;
  // Only a read that is under way or done (loader.js); this does not start one.
  const source = doc._pdfLibSource;
  if (source) {
    applyMarkupColumns(doc, source.catalog || (await source.ready)?.catalog);
    return;
  }
  // A pdf-lib document parsed on this thread.
  const parsed = doc._sharedPdfLibDoc || await doc._sharedPdfLibDocPromise;
  if (parsed) applyMarkupColumns(doc, readCatalogFields(parsed));
}
