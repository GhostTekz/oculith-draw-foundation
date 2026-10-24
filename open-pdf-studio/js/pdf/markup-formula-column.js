import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { formulaColumn, FORMULA_CHOICE_SCHEMA_VERSION, FORMULA_SECOND_NUMBER_SCHEMA_VERSION, FORMULA_JSON_MAX } from '../annotations/custom-formula-column.js';
import { readMarkupTextColumn } from './markup-text-column.js';
import { readMarkupChoiceColumn } from './markup-choice-column.js';
import { readMarkupNumberColumn } from './markup-number-column.js';
import { readMarkupSecondNumberColumn } from './markup-second-number-column.js';
import { readMarkupCheckmarkColumn } from './markup-checkmark-column.js';

const KEY = PDFName.of('OPS_MarkupFormulaColumnV1');
const CHOICE_KEY = PDFName.of('OPS_MarkupFormulaColumnV2');
const SECOND_NUMBER_KEY = PDFName.of('OPS_MarkupFormulaColumnV3');

export function readMarkupFormulaColumn(pdf) {
  let catalog;
  try { catalog = pdf.context.lookup(pdf.context.trailerInfo.Root); }
  catch { return null; }
  for (const [key, version] of [[SECOND_NUMBER_KEY, FORMULA_SECOND_NUMBER_SCHEMA_VERSION],
    [CHOICE_KEY, FORMULA_CHOICE_SCHEMA_VERSION], [KEY, 1]]) {
    try {
      const raw = catalog?.lookup(key);
      if (!(raw instanceof PDFHexString || raw instanceof PDFString)
          || raw.value.length > (FORMULA_JSON_MAX + 1) * 4) continue;
      const json = raw.decodeText();
      if (json.length > FORMULA_JSON_MAX) continue;
      const choice = readMarkupChoiceColumn(pdf);
      const formula = formulaColumn(JSON.parse(json), readMarkupNumberColumn(pdf),
        readMarkupTextColumn(pdf), choice?.name,
        readMarkupCheckmarkColumn(pdf)?.name, choice, readMarkupSecondNumberColumn(pdf));
      if (formula?.version === version) return formula;
    } catch { /* Malformed optional metadata does not hide a valid earlier definition. */ }
  }
  return null;
}

export function markupFormulaColumnForSave(doc, sourcePdf, textName, choiceDefinition,
  numberDefinition, checkmarkDefinition, secondNumberDefinition = null) {
  const secondNumber = secondNumberDefinition || doc?.markupNumberColumn2
    || readMarkupSecondNumberColumn(sourcePdf);
  const candidate = formulaColumn(doc?.markupFormulaColumn, numberDefinition,
    '', '', '', choiceDefinition, secondNumber)
    || readMarkupFormulaColumn(sourcePdf);
  if (!candidate) return null;
  const valid = formulaColumn(candidate, numberDefinition, textName, choiceDefinition?.name,
    checkmarkDefinition?.name, choiceDefinition, secondNumber);
  if (!valid) throw new Error('Formula needs its numeric source and a unique column name.');
  return valid;
}

export function saveMarkupFormulaColumn(pdf, definition) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = definition && formulaColumn(definition, readMarkupNumberColumn(pdf),
    readMarkupTextColumn(pdf), readMarkupChoiceColumn(pdf)?.name,
    readMarkupCheckmarkColumn(pdf)?.name, readMarkupChoiceColumn(pdf),
    readMarkupSecondNumberColumn(pdf));
  if (definition && !valid) throw new Error('Formula needs its numeric source and a unique column name.');
  if (valid?.version === FORMULA_SECOND_NUMBER_SCHEMA_VERSION) {
    catalog.set(SECOND_NUMBER_KEY, PDFHexString.fromText(JSON.stringify(valid)));
    catalog.delete(CHOICE_KEY);
    catalog.delete(KEY);
  } else if (valid?.version === FORMULA_CHOICE_SCHEMA_VERSION) {
    catalog.set(CHOICE_KEY, PDFHexString.fromText(JSON.stringify(valid)));
    catalog.delete(SECOND_NUMBER_KEY);
    catalog.delete(KEY);
  } else if (valid) {
    catalog.set(KEY, PDFHexString.fromText(JSON.stringify(valid)));
    catalog.delete(CHOICE_KEY);
    catalog.delete(SECOND_NUMBER_KEY);
  } else {
    catalog.delete(KEY);
    catalog.delete(CHOICE_KEY);
    catalog.delete(SECOND_NUMBER_KEY);
  }
}
