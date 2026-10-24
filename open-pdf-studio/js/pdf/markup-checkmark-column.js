import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { checkmarkColumn, CHECKMARK_JSON_MAX } from '../annotations/custom-checkmark-column.js';
import { readMarkupTextColumn } from './markup-text-column.js';
import { readMarkupChoiceColumn } from './markup-choice-column.js';
import { readMarkupNumberColumn } from './markup-number-column.js';

const KEY = PDFName.of('OPS_MarkupCheckmarkColumnV1');
const sameName = (a, b) => !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();

export function readMarkupCheckmarkColumn(pdf) {
  try {
    const raw = pdf.context.lookup(pdf.context.trailerInfo.Root)?.lookup(KEY);
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)
        || raw.value.length > (CHECKMARK_JSON_MAX + 1) * 4) return null;
    const json = raw.decodeText();
    if (json.length > CHECKMARK_JSON_MAX) return null;
    return checkmarkColumn(JSON.parse(json), readMarkupTextColumn(pdf),
      readMarkupChoiceColumn(pdf)?.name, readMarkupNumberColumn(pdf)?.name);
  } catch { return null; }
}

export function markupCheckmarkColumnForSave(doc, sourcePdf, textName, choiceDefinition, numberDefinition) {
  const definition = checkmarkColumn(doc?.markupCheckmarkColumn) || readMarkupCheckmarkColumn(sourcePdf);
  if (definition && [textName, choiceDefinition?.name, numberDefinition?.name]
    .some(name => sameName(definition.name, name))) {
    throw new Error('Text, Choice, Number and Checkmark columns need different names.');
  }
  return definition;
}

export function saveMarkupCheckmarkColumn(pdf, definition) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = checkmarkColumn(definition);
  if (valid && [readMarkupTextColumn(pdf), readMarkupChoiceColumn(pdf)?.name,
    readMarkupNumberColumn(pdf)?.name].some(name => sameName(valid.name, name))) {
    throw new Error('Text, Choice, Number and Checkmark columns need different names.');
  }
  if (valid) catalog.set(KEY, PDFHexString.fromText(JSON.stringify(valid)));
  else catalog.delete(KEY);
}
