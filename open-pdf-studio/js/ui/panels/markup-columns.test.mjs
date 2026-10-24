// Markups List columns (the external editor): the default column set and order, and the
// migration of a column choice saved before Subject became the anchor column.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARKUP_COLUMNS, ANCHOR_COLUMN, DEFAULT_VISIBLE_COLUMNS, COLUMN_STORAGE_KEY, LEGACY_COLUMN_STORAGE_KEY,
  MARKUP_COLUMN_WIDTHS, migrateColumnPrefs, readVisibleColumns, writeVisibleColumns, withColumnToggled,
  columnGridTemplate, markupSubjectLabel, readGroupBy, writeGroupBy, DEFAULT_GROUP_BY, GROUP_BY_STORAGE_KEY,
} from './markup-columns.js';
import { markupColumns as sortableColumns, sortMarkupRows } from './markup-column-sort.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test('the default columns are the external editor\'s, in the external editor order, with Subject as the anchor', () => {
  assert.deepEqual(DEFAULT_VISIBLE_COLUMNS,
    ['subject', 'pageLabel', 'page', 'lock', 'author', 'date', 'status', 'color', 'layer', 'comment']);
  assert.equal(ANCHOR_COLUMN, 'subject');
  assert.deepEqual(readVisibleColumns(memoryStorage()), DEFAULT_VISIBLE_COLUMNS);
  assert.deepEqual(readVisibleColumns(null), DEFAULT_VISIBLE_COLUMNS);
  // Every column has a grid width and can be sorted.
  for (const column of MARKUP_COLUMNS) {
    assert.ok(MARKUP_COLUMN_WIDTHS[column], column);
    assert.ok(sortableColumns.includes(column), `${column} is sortable`);
  }
  assert.equal(columnGridTemplate(['subject', 'lock']), `${MARKUP_COLUMN_WIDTHS.subject} ${MARKUP_COLUMN_WIDTHS.lock}`);
});

test('Formula, Attachments and Space columns follow the external editor columns and can be chosen and sorted', () => {
  const tail = MARKUP_COLUMNS.slice(MARKUP_COLUMNS.indexOf('customFormula') + 1);
  assert.deepEqual(tail, ['exprFormula1', 'exprFormula2', 'exprFormula3', 'exprFormula4', 'exprFormula5',
    'attachments', 'space']);
  assert.deepEqual(withColumnToggled(['subject'], 'space'), ['subject', 'space']);
  const rows = [{ v: 2 }, { v: null }, { v: 1 }];
  sortMarkupRows(rows, { column: 'exprFormula2', direction: 'ascending' }, (row) => row.v);
  assert.deepEqual(rows.map(row => row.v), [null, 1, 2], 'Formula columns sort as numbers, blanks first');
});

test('a column choice saved under v1 is kept, with Subject added in front when missing', () => {
  const v1 = JSON.stringify(['page', 'type', 'comment', 'author', 'retired-column', 'author']);
  const storage = memoryStorage({ [LEGACY_COLUMN_STORAGE_KEY]: v1 });
  assert.deepEqual(readVisibleColumns(storage), ['subject', 'page', 'type', 'comment', 'author']);
  // A v1 list that already showed Subject keeps its place.
  assert.deepEqual(migrateColumnPrefs({ v1: JSON.stringify(['type', 'subject', 'status']) }), ['type', 'subject', 'status']);
  // v2 wins over v1 once the user changed the columns again.
  storage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(['subject', 'date', 'lock']));
  assert.deepEqual(readVisibleColumns(storage), ['subject', 'date', 'lock']);
  // Garbage in either key falls back to the next source, then the default.
  assert.deepEqual(migrateColumnPrefs({ v2: '{oops', v1: JSON.stringify(['status']) }), ['subject', 'status']);
  assert.deepEqual(migrateColumnPrefs({ v2: '"text"', v1: 'null' }), DEFAULT_VISIBLE_COLUMNS);
  assert.deepEqual(readVisibleColumns({ getItem() { throw new Error('blocked'); } }), DEFAULT_VISIBLE_COLUMNS);
});

test('saving and toggling keep the anchor column', () => {
  const storage = memoryStorage();
  assert.equal(writeVisibleColumns(['date', 'lock'], storage), true);
  assert.deepEqual(JSON.parse(storage.getItem(COLUMN_STORAGE_KEY)), ['subject', 'date', 'lock']);
  assert.equal(storage.getItem(LEGACY_COLUMN_STORAGE_KEY), null, 'the v1 key is left alone');
  assert.deepEqual(withColumnToggled(['subject', 'date'], 'subject'), ['subject', 'date'], 'Subject cannot be hidden');
  assert.deepEqual(withColumnToggled(['subject', 'date'], 'date'), ['subject']);
  assert.deepEqual(withColumnToggled(['subject'], 'color'), ['subject', 'color']);
  assert.deepEqual(withColumnToggled(['subject'], 'bogus'), ['subject']);
});

test('a markup without its own subject is listed under its type name; Group By defaults to Subject', () => {
  assert.equal(markupSubjectLabel('  Architect ', 'Cloud'), 'Architect');
  assert.equal(markupSubjectLabel('', 'Cloud'), 'Cloud');
  assert.equal(markupSubjectLabel(undefined, ''), 'Markup');
  const storage = memoryStorage();
  assert.equal(readGroupBy(storage), DEFAULT_GROUP_BY);
  assert.equal(DEFAULT_GROUP_BY, 'subject');
  assert.equal(writeGroupBy('author', storage), true);
  assert.equal(readGroupBy(storage), 'author');
  assert.equal(writeGroupBy('nonsense', storage), false);
  storage.setItem(GROUP_BY_STORAGE_KEY, 'nonsense');
  assert.equal(readGroupBy(storage), 'subject');
});
