import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { statusSet, STATUS_SET_JSON_MAX } from '../annotations/markup-status.js';

// The document's own markup status set (Markups List), next to the custom
// column definitions in the catalog. Absent = the default the external editor set.
const KEY = PDFName.of('OPS_MarkupStatusSetV1');

export function readMarkupStatusSet(pdf) {
  try {
    const raw = pdf.context.lookup(pdf.context.trailerInfo.Root)?.lookup(KEY);
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)
        || raw.value.length > (STATUS_SET_JSON_MAX + 1) * 4) return null;
    const json = raw.decodeText();
    if (json.length > STATUS_SET_JSON_MAX) return null;
    return statusSet(JSON.parse(json));
  } catch { return null; }
}

/** The set to write: the document's, else what the source file had. */
export function markupStatusSetForSave(doc, sourcePdf) {
  if (doc && doc.markupStatusSet === false) return null; // removed by the user
  return statusSet(doc?.markupStatusSet) || readMarkupStatusSet(sourcePdf);
}

export function saveMarkupStatusSet(pdf, definition) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = statusSet(definition);
  if (valid) catalog.set(KEY, PDFHexString.fromText(JSON.stringify(valid)));
  else catalog.delete(KEY);
}
