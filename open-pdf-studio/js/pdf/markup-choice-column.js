import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { choiceColumn, CHOICE_JSON_MAX, CHOICE_NUMERIC_SCHEMA_VERSION } from '../annotations/custom-choice-column.js';
import { customTextColumnName } from '../annotations/custom-text-column.js';
import { readMarkupTextColumn } from './markup-text-column.js';

const KEY = PDFName.of('OPS_MarkupChoiceColumnV1');
const NUMERIC_KEY = PDFName.of('OPS_MarkupChoiceColumnV2');

export function saveMarkupChoiceColumn(pdf, definition) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = choiceColumn(definition);
  const textName = readMarkupTextColumn(pdf);
  if (valid && textName && valid.name.toLocaleLowerCase() === textName.toLocaleLowerCase()) {
    throw new Error('Text and Choice columns need different names.');
  }
  if (valid) {
    const labels = { version: 1, name: valid.name, options: valid.options };
    catalog.set(KEY, PDFHexString.fromText(JSON.stringify(labels)));
    if (valid.version === CHOICE_NUMERIC_SCHEMA_VERSION) {
      catalog.set(NUMERIC_KEY, PDFHexString.fromText(JSON.stringify(valid)));
    } else catalog.delete(NUMERIC_KEY);
  } else {
    catalog.delete(KEY);
    catalog.delete(NUMERIC_KEY);
  }
}

export function readMarkupChoiceColumn(pdf) {
  try {
    const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
    const raw = catalog?.lookup(KEY);
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)) return null;
    // Check encoded size before decoding untrusted PDF bytes.
    if (raw.value.length > (CHOICE_JSON_MAX + 1) * 4) return null;
    const json = raw.decodeText();
    if (json.length > CHOICE_JSON_MAX) return null;
    const labels = choiceColumn(JSON.parse(json), readMarkupTextColumn(pdf));
    if (!labels || labels.version !== 1) return null;
    let numericRaw;
    try { numericRaw = catalog.lookup(NUMERIC_KEY); }
    catch { return labels; }
    if (!(numericRaw instanceof PDFHexString || numericRaw instanceof PDFString)
        || numericRaw.value.length > (CHOICE_JSON_MAX + 1) * 4) return labels;
    const numericJson = numericRaw.decodeText();
    if (numericJson.length > CHOICE_JSON_MAX) return labels;
    try {
      const numeric = choiceColumn(JSON.parse(numericJson), readMarkupTextColumn(pdf));
      return numeric?.version === CHOICE_NUMERIC_SCHEMA_VERSION
        && numeric.name === labels.name && numeric.options.length === labels.options.length
        && numeric.options.every((option, index) => option === labels.options[index])
        ? numeric : labels;
    } catch { return labels; }
  } catch { return null; }
}

export function markupChoiceColumnForSave(doc, sourcePdf) {
  const definition = choiceColumn(doc?.markupChoiceColumn) || readMarkupChoiceColumn(sourcePdf);
  const textName = customTextColumnName(doc?.markupTextColumnName) || readMarkupTextColumn(sourcePdf);
  if (definition && textName && definition.name.toLocaleLowerCase() === textName.toLocaleLowerCase()) {
    // Reject before the saver writes annotations or mutates either catalog key.
    throw new Error('Text and Choice columns need different names.');
  }
  return definition;
}
