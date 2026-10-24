// XLSX export of the Markups List with its Formula columns (beyond the external editor,
// which exports CSV/XML/PDF). Rows: one per markup plus a totals row; the
// workbook comes from pdf/office-files.js buildXlsx.
import { buildXlsx } from '../pdf/office-files.js';
import { numberColumn, numberText } from './custom-number-column.js';
import { choiceColumn, choiceValue } from './custom-choice-column.js';
import { measureKindType } from './measure-extras.js';
import {
  expressionColumns, columnSources, evaluateExpressionColumns, expressionColumnTotals, measurementQuantities,
} from './formula-captions.js';

const fixed = (value, decimals) => (value === null || value === undefined || !Number.isFinite(value)
  ? '' : value.toFixed(decimals));

/**
 * Table rows (header first) for `annotations`. Measurement values keep their
 * unit in a separate column; an uncalibrated markup has "Scale not set" and
 * blank formula cells (K-004).
 */
export function takeoffRows(annotations, doc) {
  const columns = expressionColumns(doc?.formulaCaptions?.columns);
  const sources = columnSources(doc);
  const numbers = [numberColumn(doc?.markupNumberColumn), numberColumn(doc?.markupNumberColumn2)];
  const choices = [choiceColumn(doc?.markupChoiceColumn), choiceColumn(doc?.markupChoiceColumn2)];
  const header = ['Page', 'Type', 'Subject', 'Comment', 'Measurement', 'Unit', 'Scale',
    ...choices.filter(Boolean).map(c => c.name), ...numbers.filter(Boolean).map(n => n.name),
    ...columns.map(c => (c.unit ? `${c.name} (${c.unit})` : c.name))];
  const rows = [header];
  for (const ann of annotations || []) {
    const q = measurementQuantities(ann);
    const measured = q.volume ?? q.area ?? q.length ?? q.count;
    const unit = q.count !== null ? '' : `${q.unit}${q.volume !== null ? '³' : q.area !== null ? '²' : ''}`;
    const results = evaluateExpressionColumns(ann, doc, columns, sources);
    rows.push([
      String(ann.page ?? ''), measureKindType(ann) || '', ann.subject || '',
      typeof ann.text === 'string' ? ann.text : '',
      measured === null ? '' : fixed(measured, q.count !== null ? 0 : 4), measured === null ? '' : unit,
      measured === null || q.count !== null ? '' : (q.calibrated ? 'set' : 'Scale not set'),
      ...(choices[0] ? [choiceValue(ann.markupChoiceValue, choices[0].options)] : []),
      ...(choices[1] ? [choiceValue(ann.markupChoiceValue2, choices[1].options)] : []),
      ...(numbers[0] ? [numberText(ann.markupNumberValue)] : []),
      ...(numbers[1] ? [numberText(ann.markupNumberValue2)] : []),
      ...results.map((r, i) => fixed(r.value, columns[i].decimals)),
    ]);
  }
  if (columns.length) {
    const totals = expressionColumnTotals(annotations, doc, columns);
    const filler = header.length - columns.length;
    rows.push(['Total', ...Array(filler - 1).fill(''),
      ...totals.map((t, i) => (t.counted ? fixed(t.total, columns[i].decimals) : ''))]);
  }
  return rows;
}

/** XLSX bytes of the takeoff rows. */
export function takeoffXlsx(annotations, doc, title = 'Markups') {
  return buildXlsx([{ number: 1, blocks: [{ type: 'table', rows: takeoffRows(annotations, doc) }] }],
    { title, pageLabel: 'Markups', tableLabel: 'List' });
}
