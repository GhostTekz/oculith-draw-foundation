import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { numberColumn, NUMBER_JSON_MAX } from '../annotations/custom-number-column.js';

const KEY = PDFName.of('OPS_MarkupNumberColumn2V1');

export function readMarkupSecondNumberColumn(pdf) {
  try {
    const raw = pdf.context.lookup(pdf.context.trailerInfo.Root)?.lookup(KEY);
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)
        || raw.value.length > (NUMBER_JSON_MAX + 1) * 4) return null;
    const json = raw.decodeText();
    return json.length <= NUMBER_JSON_MAX ? numberColumn(JSON.parse(json)) : null;
  } catch { return null; }
}

export function secondNumberColumnForSave(doc, sourcePdf, existingNames = []) {
  const definition = numberColumn(doc?.markupNumberColumn2) || readMarkupSecondNumberColumn(sourcePdf);
  if (definition && existingNames.some(other =>
    definition.name.toLocaleLowerCase() === other?.toLocaleLowerCase())) {
    throw new Error('Custom columns need different names.');
  }
  return definition;
}

export function saveMarkupSecondNumberColumn(pdf, definition) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = numberColumn(definition);
  if (valid) catalog.set(KEY, PDFHexString.fromText(JSON.stringify(valid)));
  else catalog.delete(KEY);
}
