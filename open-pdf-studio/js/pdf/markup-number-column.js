import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { numberColumn, NUMBER_JSON_MAX } from '../annotations/custom-number-column.js';
import { customTextColumnName } from '../annotations/custom-text-column.js';
import { readMarkupTextColumn } from './markup-text-column.js';
import { readMarkupChoiceColumn } from './markup-choice-column.js';

const KEY = PDFName.of('OPS_MarkupNumberColumnV1');
const sameName = (a, b) => !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();

export function readMarkupNumberColumn(pdf) {
  try {
    const raw = pdf.context.lookup(pdf.context.trailerInfo.Root)?.lookup(KEY);
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)
        || raw.value.length > (NUMBER_JSON_MAX + 1) * 4) return null;
    const json = raw.decodeText();
    if (json.length > NUMBER_JSON_MAX) return null;
    return numberColumn(JSON.parse(json), readMarkupTextColumn(pdf), readMarkupChoiceColumn(pdf)?.name);
  } catch { return null; }
}

export function markupNumberColumnForSave(doc, sourcePdf, textName, choiceDefinition) {
  const definition = numberColumn(doc?.markupNumberColumn) || readMarkupNumberColumn(sourcePdf);
  const text = customTextColumnName(textName);
  const choice = choiceDefinition?.name || '';
  if (definition && (sameName(definition.name, text) || sameName(definition.name, choice))) {
    throw new Error('Text, Choice and Number columns need different names.');
  }
  return definition;
}

export function saveMarkupNumberColumn(pdf, definition) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = numberColumn(definition);
  const textName = readMarkupTextColumn(pdf);
  const choiceName = readMarkupChoiceColumn(pdf)?.name;
  if (valid && (sameName(valid.name, textName) || sameName(valid.name, choiceName))) {
    throw new Error('Text, Choice and Number columns need different names.');
  }
  if (valid) catalog.set(KEY, PDFHexString.fromText(JSON.stringify(valid)));
  else catalog.delete(KEY);
}
