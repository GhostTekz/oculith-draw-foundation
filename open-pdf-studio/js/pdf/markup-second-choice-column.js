import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { choiceColumn, CHOICE_JSON_MAX, CHOICE_NUMERIC_SCHEMA_VERSION } from '../annotations/custom-choice-column.js';

const LABEL_KEY = PDFName.of('OPS_MarkupChoiceColumn2V1');
const NUMERIC_KEY = PDFName.of('OPS_MarkupChoiceColumn2V2');

function readBoundedJson(catalog, key) {
  const raw = catalog?.lookup(key);
  if (!(raw instanceof PDFHexString || raw instanceof PDFString)
      || raw.value.length > (CHOICE_JSON_MAX + 1) * 4) return null;
  const text = raw.decodeText();
  return text.length <= CHOICE_JSON_MAX ? JSON.parse(text) : null;
}

/** Separate keys leave the original Choice and Formula source contract intact. */
export function readMarkupSecondChoiceColumn(pdf) {
  try {
    const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
    const labels = choiceColumn(readBoundedJson(catalog, LABEL_KEY));
    if (!labels || labels.version !== 1) return null;
    let numeric;
    try { numeric = choiceColumn(readBoundedJson(catalog, NUMERIC_KEY)); }
    catch { return labels; }
    return numeric?.version === CHOICE_NUMERIC_SCHEMA_VERSION
      && numeric.name === labels.name && numeric.options.length === labels.options.length
      && numeric.options.every((option, index) => option === labels.options[index])
      ? numeric : labels;
  } catch { return null; }
}

export function secondChoiceColumnForSave(doc, sourcePdf, existingNames = []) {
  const definition = choiceColumn(doc?.markupChoiceColumn2) || readMarkupSecondChoiceColumn(sourcePdf);
  if (definition && existingNames.some(other =>
    definition.name.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Custom columns need different names.');
  }
  return definition;
}

export function saveMarkupSecondChoiceColumn(pdf, definition) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = choiceColumn(definition);
  if (!valid) {
    catalog.delete(LABEL_KEY);
    catalog.delete(NUMERIC_KEY);
    return;
  }
  catalog.set(LABEL_KEY, PDFHexString.fromText(JSON.stringify({ version: 1,
    name: valid.name, options: valid.options })));
  if (valid.version === CHOICE_NUMERIC_SCHEMA_VERSION) {
    catalog.set(NUMERIC_KEY, PDFHexString.fromText(JSON.stringify(valid)));
  } else catalog.delete(NUMERIC_KEY);
}
