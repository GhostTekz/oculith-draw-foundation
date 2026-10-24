import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { customTextColumnName } from '../annotations/custom-text-column.js';

const KEY = PDFName.of('OPS_MarkupTextColumn');
const SECOND_KEY = PDFName.of('OPS_MarkupTextColumn2V1');

export function saveMarkupTextColumn(pdf, name) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = customTextColumnName(name);
  if (valid) catalog.set(KEY, PDFHexString.fromText(valid));
  else catalog.delete(KEY);
}

export function readMarkupTextColumn(pdf) {
  try {
    const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
    const raw = catalog?.lookup(KEY);
    return (raw instanceof PDFHexString || raw instanceof PDFString) && raw.value.length <= 256
      ? customTextColumnName(raw.decodeText()) : '';
  } catch { return ''; }
}

// The catalog load in loader.js runs alongside first paint. Saving during
// that read must retain the column already present in the source PDF.
export function markupTextColumnForSave(doc, sourcePdf) {
  return customTextColumnName(doc?.markupTextColumnName) || readMarkupTextColumn(sourcePdf);
}

/** A distinct catalog entry keeps PDFs with only the original Text column unchanged. */
export function readMarkupSecondTextColumn(pdf) {
  try {
    const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
    const raw = catalog?.lookup(SECOND_KEY);
    return (raw instanceof PDFHexString || raw instanceof PDFString) && raw.value.length <= 256
      ? customTextColumnName(raw.decodeText()) : '';
  } catch { return ''; }
}

export function secondTextColumnForSave(doc, sourcePdf, existingNames = []) {
  const name = customTextColumnName(doc?.markupTextColumn2Name) || readMarkupSecondTextColumn(sourcePdf);
  if (name && existingNames.some(other => name.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Text columns and other custom columns need different names.');
  }
  return name;
}

export function saveMarkupSecondTextColumn(pdf, name) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = customTextColumnName(name);
  if (valid) catalog.set(SECOND_KEY, PDFHexString.fromText(valid));
  else catalog.delete(SECOND_KEY);
}
