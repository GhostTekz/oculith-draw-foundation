import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMarkupColumnSort, sortMarkupRows } from './markup-column-sort.js';

test('header clicks choose a column then reverse its direction', () => {
  const first = nextMarkupColumnSort(null, 'page');
  assert.deepEqual(first, { column: 'page', direction: 'ascending' });
  assert.deepEqual(nextMarkupColumnSort(first, 'page'), { column: 'page', direction: 'descending' });
  assert.deepEqual(nextMarkupColumnSort(nextMarkupColumnSort(first, 'page'), 'type'),
    { column: 'type', direction: 'ascending' });
  assert.equal(nextMarkupColumnSort(first, 'unknown'), first);
});

test('column order sorts only supplied rows, preserves ties, and handles numeric pages', () => {
  const rows = [
    { id: 'a', page: 10, author: 'Zoe' },
    { id: 'b', page: 2, author: 'Amy' },
    { id: 'c', page: 2, author: 'Amy' },
  ];
  const value = (row, column) => row[column];
  assert.deepEqual(sortMarkupRows([...rows], { column: 'page', direction: 'ascending' }, value).map(r => r.id), ['b', 'c', 'a']);
  assert.deepEqual(sortMarkupRows([...rows], { column: 'author', direction: 'descending' }, value).map(r => r.id), ['a', 'b', 'c']);
  assert.deepEqual(rows.map(r => r.id), ['a', 'b', 'c']);
});

test('Subject sorts case-insensitively within the supplied group', () => {
  const rows = [{ id: 'a', subject: 'Steel' }, { id: 'b', subject: 'electrical' }, { id: 'c', subject: '' }];
  const sorted = sortMarkupRows([...rows], nextMarkupColumnSort(null, 'subject'), (row, column) => row[column]);
  assert.deepEqual(sorted.map(row => row.id), ['c', 'b', 'a']);
});

test('the named text column sorts natural values and reverses on a second header click', () => {
  const rows = [
    { id: 'a', customText: 'Phase 10' },
    { id: 'b', customText: 'Phase 2' },
    { id: 'c', customText: '' },
    { id: 'd', customText: 'phase 2' },
  ];
  const ascending = nextMarkupColumnSort(null, 'customText');
  assert.deepEqual(ascending, { column: 'customText', direction: 'ascending' });
  assert.deepEqual(sortMarkupRows([...rows], ascending, (row, column) => row[column]).map(row => row.id),
    ['c', 'b', 'd', 'a']);
  assert.deepEqual(sortMarkupRows([...rows], nextMarkupColumnSort(ascending, 'customText'),
    (row, column) => row[column]).map(row => row.id), ['a', 'b', 'd', 'c']);
});

test('second Text column sorts its own values', () => {
  const rows = [{ id: 'a', customText2: 'Note 10' }, { id: 'b', customText2: 'Note 2' }];
  assert.deepEqual(sortMarkupRows(rows, nextMarkupColumnSort(null, 'customText2'),
    (row, column) => row[column]).map(row => row.id), ['b', 'a']);
});

test('the Choice column header sorts defined labels and reverses', () => {
  const rows = [
    { id: 'a', customChoice: 'Review' },
    { id: 'b', customChoice: 'Approved' },
    { id: 'c', customChoice: '' },
  ];
  const ascending = nextMarkupColumnSort(null, 'customChoice');
  assert.deepEqual(ascending, { column: 'customChoice', direction: 'ascending' });
  assert.deepEqual(sortMarkupRows([...rows], ascending, (row, column) => row[column]).map(row => row.id),
    ['c', 'b', 'a']);
  assert.deepEqual(sortMarkupRows([...rows], nextMarkupColumnSort(ascending, 'customChoice'),
    (row, column) => row[column]).map(row => row.id), ['a', 'b', 'c']);
});

test('second Choice header sorts its own labels', () => {
  const rows = [{ id: 'a', customChoice2: 'Review' }, { id: 'b', customChoice2: 'Approved' }];
  assert.deepEqual(sortMarkupRows(rows, nextMarkupColumnSort(null, 'customChoice2'),
    (row, column) => row[column]).map(row => row.id), ['b', 'a']);
});

test('Number sorts mathematically across negative, zero and positive values', () => {
  const rows = [{ id: 'positive', customNumber: 12.5 }, { id: 'negative', customNumber: -7.25 },
    { id: 'blank', customNumber: null }, { id: 'zero', customNumber: 0 },
    { id: 'small', customNumber: 2 }];
  const ascending = nextMarkupColumnSort(null, 'customNumber');
  const value = (row, column) => row[column];
  assert.deepEqual(sortMarkupRows([...rows], ascending, value).map(row => row.id),
    ['blank', 'negative', 'zero', 'small', 'positive']);
  assert.deepEqual(sortMarkupRows([...rows], nextMarkupColumnSort(ascending, 'customNumber'), value)
    .map(row => row.id), ['positive', 'small', 'zero', 'negative', 'blank']);
});

test('second Number sorts mathematically and keeps blanks at the edge', () => {
  const rows = [{ id: 'a', customNumber2: 2 }, { id: 'b', customNumber2: -7.25 },
    { id: 'c', customNumber2: null }, { id: 'd', customNumber2: 0 }];
  assert.deepEqual(sortMarkupRows(rows, nextMarkupColumnSort(null, 'customNumber2'),
    (row, column) => row[column]).map(row => row.id), ['c', 'b', 'd', 'a']);
});

test('Formula sorts numeric results and leaves blank inputs at the edge', () => {
  const rows = [{ id: 'positive', customFormula: 554050610405833n },
    { id: 'lower-sixth-decimal', customFormula: 554050610405832n },
    { id: 'negative', customFormula: -88625000n }, { id: 'blank', customFormula: null }];
  const ascending = nextMarkupColumnSort(null, 'customFormula');
  assert.deepEqual(sortMarkupRows([...rows], ascending, (row, column) => row[column]).map(row => row.id),
    ['blank', 'negative', 'lower-sixth-decimal', 'positive']);
  assert.deepEqual(sortMarkupRows([...rows], nextMarkupColumnSort(ascending, 'customFormula'),
    (row, column) => row[column]).map(row => row.id),
  ['positive', 'lower-sixth-decimal', 'negative', 'blank']);
});

test('Checkmark sort orders unanswered, explicit unchecked, then checked', () => {
  const rows = [{ id: 'checked', rank: 2 }, { id: 'blank', rank: 0 },
    { id: 'unchecked', rank: 1 }];
  const ascending = nextMarkupColumnSort(null, 'customCheckmark');
  const value = row => row.rank;
  assert.deepEqual(sortMarkupRows([...rows], ascending, value).map(row => row.id),
    ['blank', 'unchecked', 'checked']);
  assert.deepEqual(sortMarkupRows([...rows], nextMarkupColumnSort(ascending, 'customCheckmark'), value)
    .map(row => row.id), ['checked', 'unchecked', 'blank']);
});
