// Per-column value filters for the Markups List (the external editor "Filter List"): each
// filterable column header has a checklist of the values in the list; an
// unchecked value hides its rows. State is { column: [hidden values] }; the
// empty value '' stands for a blank cell. List rows only: the canvas is not
// filtered (the Status filter in Show is the one that also hides markups).

export const FILTERABLE_COLUMNS = ['page', 'type', 'status', 'author', 'subject', 'layer', 'customText',
  'customText2', 'customChoice', 'customChoice2', 'customNumber', 'customNumber2', 'customCheckmark',
  'customFormula', 'pageLabel', 'space'];
const VALUE_MAX = 256;
const VALUES_MAX = 500;

/** Clean filter state: known columns, string values, no empty lists. */
export function normalizeColumnFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const column of FILTERABLE_COLUMNS) {
    const list = value[column];
    if (!Array.isArray(list)) continue;
    const hidden = [...new Set(list.filter(v => typeof v === 'string' && v.length <= VALUE_MAX))].slice(0, VALUES_MAX);
    if (hidden.length) out[column] = hidden;
  }
  return out;
}

export function activeColumnFilters(filters) {
  return Object.keys(normalizeColumnFilters(filters));
}

/** Show or hide one value of a column; returns new state. */
export function toggleColumnFilterValue(filters, column, value) {
  if (!FILTERABLE_COLUMNS.includes(column)) return filters;
  const hidden = new Set(filters?.[column] || []);
  if (hidden.has(value)) hidden.delete(value);
  else hidden.add(value);
  return normalizeColumnFilters({ ...filters, [column]: [...hidden] });
}

/** Hide every value but `keep` (the external editor's "only this"), or show all with null. */
export function setColumnFilterValues(filters, column, hiddenValues) {
  if (!FILTERABLE_COLUMNS.includes(column)) return filters;
  return normalizeColumnFilters({ ...filters, [column]: hiddenValues || [] });
}

/** A row filter for the active column filters, or null when none is set. */
export function columnFilterPredicate(filters, textFor) {
  const active = Object.entries(normalizeColumnFilters(filters)).map(([column, values]) => [column, new Set(values)]);
  if (!active.length) return null;
  return annotation => active.every(([column, hidden]) => !hidden.has(String(textFor(annotation, column) ?? '')));
}

/** The distinct values of a column with their counts, in natural order. */
export function columnFilterValues(annotations, column, textFor) {
  const counts = new Map();
  for (const annotation of annotations || []) {
    const text = String(textFor(annotation, column) ?? '');
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  const numeric = column === 'page' || column === 'customNumber' || column === 'customNumber2' || column === 'customFormula';
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => {
    if (a.value === '' || b.value === '') return a.value === '' ? 1 : -1;
    if (numeric && Number.isFinite(Number(a.value)) && Number.isFinite(Number(b.value))) return Number(a.value) - Number(b.value);
    return a.value.localeCompare(b.value, undefined, { numeric: true, sensitivity: 'base' });
  });
}
