// Markups List columns (the external editor layout): which columns exist, the default set
// and order, their grid widths, and the saved column choice.
//
// the external editor's default Markups List shows Subject, Page Label, Page Index, Lock,
// Author, Date, Status, Color, Layer and Comments. Subject is the anchor
// column (always visible): it carries the markup's type icon, its subject
// (or type name when the subject is blank, as the external editor fills it in) and the reply
// thread toggle. Every other column can be hidden and reordered.
//
// Saved choice: localStorage `ocudraw.markups.visibleColumns.v2`. A list the
// user saved under v1 (when Type was the anchor) is kept as it was, with
// Subject added in front when it is missing; a store without any saved list
// gets the external editor default. Unknown keys are dropped. Pure (no Solid), so the
// node tests cover it.
//
// After the external editor columns: the Formula (expression) columns, Attachments
// (capture.js) and Space (Spaces panel); the panel hides a Formula column
// until it has an expression.

import { EXPRESSION_COLUMN_KEYS } from '../../annotations/formula-captions.js';

export const MARKUP_COLUMNS = Object.freeze(['subject', 'pageLabel', 'page', 'lock', 'author', 'date',
  'status', 'color', 'layer', 'comment', 'type', 'customText', 'customText2', 'customChoice',
  'customChoice2', 'customNumber', 'customNumber2', 'customCheckmark', 'customFormula',
  ...EXPRESSION_COLUMN_KEYS, 'attachments', 'space']);

/** The column that cannot be hidden. */
export const ANCHOR_COLUMN = 'subject';

/** the external editor's default columns, in the external editor order. */
export const DEFAULT_VISIBLE_COLUMNS = Object.freeze(['subject', 'pageLabel', 'page', 'lock', 'author', 'date',
  'status', 'color', 'layer', 'comment']);

export const COLUMN_STORAGE_KEY = 'ocudraw.markups.visibleColumns.v2';
export const LEGACY_COLUMN_STORAGE_KEY = 'ocudraw.markups.visibleColumns.v1';

/** CSS grid track per column (header and rows share the template). */
export const MARKUP_COLUMN_WIDTHS = Object.freeze({
  subject: 'minmax(150px, 1.6fr)',
  pageLabel: 'minmax(80px, 0.8fr)',
  page: '86px',
  lock: '44px',
  author: 'minmax(90px, 1fr)',
  date: 'minmax(132px, 1.1fr)',
  status: 'minmax(84px, 0.9fr)',
  color: '52px',
  layer: 'minmax(90px, 1fr)',
  comment: 'minmax(160px, 2.2fr)',
  type: 'minmax(92px, 1fr)',
  customText: 'minmax(120px, 1.4fr)',
  customText2: 'minmax(120px, 1.4fr)',
  customChoice: 'minmax(120px, 1.4fr)',
  customChoice2: 'minmax(120px, 1.4fr)',
  customNumber: 'minmax(120px, 1.4fr)',
  customNumber2: 'minmax(120px, 1.4fr)',
  customCheckmark: 'minmax(120px, 1.4fr)',
  customFormula: 'minmax(120px, 1.4fr)',
  ...Object.fromEntries(EXPRESSION_COLUMN_KEYS.map(key => [key, 'minmax(110px, 1.2fr)'])),
  attachments: '72px',
  space: 'minmax(96px, 1.2fr)',
});

/** Known columns only, each once, the anchor always present (first if it was missing). */
export function sanitizeColumns(list) {
  if (!Array.isArray(list)) return null;
  const visible = [...new Set(list.filter(column => MARKUP_COLUMNS.includes(column)))];
  if (!visible.includes(ANCHOR_COLUMN)) visible.unshift(ANCHOR_COLUMN);
  return visible;
}

function parse(raw) {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * The visible columns from the stored strings: a valid v2 list, else the v1
 * list (migrated: same columns and order, Subject added in front), else the
 * the external editor default.
 */
export function migrateColumnPrefs({ v2 = null, v1 = null } = {}) {
  const current = sanitizeColumns(parse(v2));
  if (current) return current;
  const legacy = sanitizeColumns(parse(v1));
  if (legacy) return legacy;
  return [...DEFAULT_VISIBLE_COLUMNS];
}

/** Read the visible columns from a Storage (localStorage); never throws. */
export function readVisibleColumns(storage = globalThis.localStorage) {
  try {
    return migrateColumnPrefs({
      v2: storage?.getItem(COLUMN_STORAGE_KEY) ?? null,
      v1: storage?.getItem(LEGACY_COLUMN_STORAGE_KEY) ?? null,
    });
  } catch {
    return [...DEFAULT_VISIBLE_COLUMNS];
  }
}

/** Save the visible columns (v2); false when storage is unavailable. */
export function writeVisibleColumns(list, storage = globalThis.localStorage) {
  const clean = sanitizeColumns(list) || [...DEFAULT_VISIBLE_COLUMNS];
  try {
    storage?.setItem(COLUMN_STORAGE_KEY, JSON.stringify(clean));
    return !!storage;
  } catch {
    return false;
  }
}

/**
 * Make these columns visible (keeping the ones already shown) and tell an
 * open Markups List, so a feature that fills a column also shows it.
 */
export function showMarkupColumns(columns, storage = globalThis.localStorage) {
  const current = readVisibleColumns(storage);
  const next = [...current, ...columns.filter((c) => !current.includes(c))];
  if (next.length === current.length) return false;
  writeVisibleColumns(next, storage);
  try { globalThis.dispatchEvent?.(new CustomEvent('ocudraw:markup-columns', { detail: { columns: next } })); } catch { /* no window */ }
  return true;
}

/** Show or hide one column (the anchor stays). */
export function withColumnToggled(list, column) {
  if (column === ANCHOR_COLUMN || !MARKUP_COLUMNS.includes(column)) return list;
  return list.includes(column) ? list.filter(key => key !== column) : [...list, column];
}

/** CSS grid-template-columns for the shown columns. */
export function columnGridTemplate(columns) {
  return columns.map(column => MARKUP_COLUMN_WIDTHS[column] || 'minmax(80px, 1fr)').join(' ');
}

/**
 * The subject a markup is listed and grouped under: its own subject, else the
 * type name (the external editor gives every markup its tool's name as the default subject).
 */
export function markupSubjectLabel(subject, typeLabel) {
  const own = typeof subject === 'string' ? subject.trim() : '';
  return own || String(typeLabel || '').trim() || 'Markup';
}

/** The default Group By of the Markups List (the external editor groups by Subject). */
export const DEFAULT_GROUP_BY = 'subject';
export const GROUP_BY_STORAGE_KEY = 'ocudraw.markups.groupBy.v1';
export const GROUP_BY_KEYS = Object.freeze(['page', 'type', 'modifiedDate', 'creationDate', 'author', 'color',
  'subject', 'status', 'statusAndAuthor', 'lastStatusAuthor', 'layer', 'markupGroup']);

/** The saved Group By, or the external editor default. */
export function readGroupBy(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(GROUP_BY_STORAGE_KEY);
    return GROUP_BY_KEYS.includes(saved) ? saved : DEFAULT_GROUP_BY;
  } catch {
    return DEFAULT_GROUP_BY;
  }
}

export function writeGroupBy(value, storage = globalThis.localStorage) {
  if (!GROUP_BY_KEYS.includes(value)) return false;
  try { storage?.setItem(GROUP_BY_STORAGE_KEY, value); return !!storage; } catch { return false; }
}
