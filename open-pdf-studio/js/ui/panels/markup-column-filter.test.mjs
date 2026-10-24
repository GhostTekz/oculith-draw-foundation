// Markups List column header filters (the external editor Filter List).
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { list, store, showList } = await import('./annotations-list.testhulp.mjs');
const { normalizeColumnFilters, toggleColumnFilterValue, columnFilterPredicate, columnFilterValues,
  setColumnFilterValues, activeColumnFilters } = await import('./markup-column-filter.js');

test('filter state keeps known columns and string values only', () => {
  assert.deepEqual(normalizeColumnFilters({ author: ['Bo', 3, 'Bo'], nope: ['x'], page: [] }), { author: ['Bo'] });
  assert.deepEqual(normalizeColumnFilters(null), {});
  let filters = toggleColumnFilterValue({}, 'author', 'Bo');
  assert.deepEqual(filters, { author: ['Bo'] });
  filters = toggleColumnFilterValue(filters, 'author', 'Bo');
  assert.deepEqual(filters, {}, 'showing the last hidden value removes the filter');
  assert.deepEqual(activeColumnFilters(setColumnFilterValues({}, 'status', ['', 'Accepted'])), ['status']);
  assert.equal(columnFilterPredicate({}, () => ''), null);
  const keep = columnFilterPredicate({ author: ['Bo'], status: [''] }, (row, column) => row[column]);
  assert.equal(keep({ author: 'Cy', status: 'Accepted' }), true);
  assert.equal(keep({ author: 'Bo', status: 'Accepted' }), false);
  assert.equal(keep({ author: 'Cy', status: '' }), false, 'the blank value is a value');
  assert.deepEqual(columnFilterValues([{ page: '10' }, { page: '2' }, { page: '2' }, { page: '' }], 'page', (r, c) => r[c]),
    [{ value: '2', count: 2 }, { value: '10', count: 1 }, { value: '', count: 1 }]);
});

function openDoc() {
  state.documents = [{ id: `filters-${Math.random()}`, currentPage: 1, viewMode: 'single', selectedAnnotations: [],
    annotations: [
      { id: 'a', type: 'box', page: 1, author: 'Bo', status: 'accepted', subject: 'Clash', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'b', type: 'box', page: 2, author: 'Cy', subject: 'Clash', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'c', type: 'line', page: 2, author: 'Bo', status: 'Rejected', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'vp', type: 'scaleRegion', page: 1 },
    ] }];
  state.activeDocumentIndex = 0;
  store.setColumnFilters({});
  store.setSearchQuery('');
  store.replaceHiddenStatuses([]);
}
const ids = () => store.items().filter(item => !item.isHeader).map(item => item.id);

test('the header checklist lists every value with counts, the blank cell last', () => {
  showList();
  openDoc();
  assert.deepEqual(list.markupColumnFilterValues('author'), [{ value: 'Bo', count: 2 }, { value: 'Cy', count: 1 }]);
  assert.deepEqual(list.markupColumnFilterValues('status'),
    [{ value: 'Accepted', count: 1 }, { value: 'Rejected', count: 1 }, { value: '', count: 1 }]);
  assert.deepEqual(list.markupColumnFilterValues('comment'), [], 'free text is not a checklist');
});

test('unchecked values hide their rows; filters combine with each other, search and the count', () => {
  showList();
  openDoc();
  store.setColumnFilters({ author: ['Cy'] });
  list.updateAnnotationsList();
  assert.deepEqual(ids(), ['a', 'c']);
  store.setColumnFilters({ author: ['Cy'], status: ['Rejected'] });
  list.updateAnnotationsList();
  assert.deepEqual(ids(), ['a']);
  assert.equal(store.countText(), '1 annotation');
  store.setColumnFilters({ subject: [''] });
  store.setSearchQuery('line');
  list.updateAnnotationsList();
  assert.deepEqual(ids(), [], 'the line has no subject and is filtered out before the search');
  store.setColumnFilters({});
  list.updateAnnotationsList();
  assert.deepEqual(ids(), ['c']);
  store.setSearchQuery('');
});
