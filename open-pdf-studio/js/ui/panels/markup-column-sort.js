import { EXPRESSION_COLUMN_KEYS } from '../../annotations/formula-captions.js';

export const markupColumns = ['page', 'type', 'comment', 'status', 'author', 'subject', 'customText', 'customText2', 'customChoice', 'customChoice2', 'customNumber', 'customNumber2', 'customCheckmark', 'customFormula', 'layer', 'pageLabel', 'lock', 'date', 'color', ...EXPRESSION_COLUMN_KEYS, 'attachments', 'space'];

export function nextMarkupColumnSort(current, column) {
  if (!markupColumns.includes(column)) return current;
  return {
    column,
    direction: current?.column === column && current.direction === 'ascending'
      ? 'descending' : 'ascending',
  };
}

// localeCompare() sets up the locale's collation on every call; one collator
// serves every sort.
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Resolve each displayed markup's sort value once during a list build. */
export function memoizeMarkupSortValue(valueForColumn) {
  const values = new Map();
  return (row, column) => {
    if (!values.has(row)) values.set(row, valueForColumn(row, column));
    return values.get(row);
  };
}

/** Sort displayed rows within a group; the caller retains its group/filter order. */
export function sortMarkupRows(rows, sort, valueForColumn) {
  if (!sort || !markupColumns.includes(sort.column)) return rows;
  const factor = sort.direction === 'descending' ? -1 : 1;
  return rows.sort((a, b) => {
    const av = valueForColumn(a, sort.column);
    const bv = valueForColumn(b, sort.column);
    if (sort.column === 'page' || sort.column === 'lock' || sort.column === 'date') return factor * (av - bv);
    if (sort.column === 'customCheckmark' || sort.column === 'attachments') return factor * (av - bv);
    if (sort.column === 'customNumber' || sort.column === 'customNumber2' || sort.column === 'customFormula'
      || EXPRESSION_COLUMN_KEYS.includes(sort.column)) {
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : -factor;
      if (bv === null || bv === undefined) return factor;
      return factor * (av < bv ? -1 : av > bv ? 1 : 0);
    }
    return factor * naturalCollator.compare(String(av), String(bv));
  });
}
