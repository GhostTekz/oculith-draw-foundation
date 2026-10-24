// Markups List grouping (the external editor): rows are grouped by Subject by default, a
// markup without its own subject sits under its type name, each group header
// carries its count, groups collapse, and the Lock, Date and Color columns
// have their cell values and sort.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { list, store, showList } = await import('./annotations-list.testhulp.mjs');
const { getTypeDisplayName } = await import('../../utils/helpers.js');

const box = (id, extra = {}) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5, author: 'Ann',
  createdAt: '2026-10-01T00:00:00Z', modifiedAt: '2026-10-01T00:00:00Z', ...extra });

function openDoc(annotations) {
  state.documents = [{ id: `groups-${Math.random()}`, currentPage: 1, viewMode: 'single',
    annotations, selectedAnnotations: [] }];
  state.activeDocumentIndex = 0;
  store.setColumnFilters({});
  store.setColumnSort(null);
  store.setSearchQuery('');
  store.expandAllGroups();
}
const headers = () => store.items().filter(item => item.isHeader).map(item => [item.headerLabel, item.count]);
const rowIds = () => store.items().filter(item => !item.isHeader && !item.isReply).map(item => item.id);

test('rows are grouped by Subject by default, with counts; a blank subject groups under the type name', () => {
  showList();
  assert.equal(store.sortMode(), 'subject');
  openDoc([
    box('a', { subject: 'Architect', page: 2 }),
    box('b'),
    { ...box('c', { subject: 'Architect' }), type: 'circle' },
    { ...box('d', { subject: '  ' }), type: 'line', x1: 0, y1: 0, x2: 9, y2: 9 },
    box('e', { subject: 'Engineer' }),
  ]);
  list.updateAnnotationsList();
  // Type names come from the translations (Rectangle in the app; the node
  // run may have none loaded), so the expectation asks the same helper.
  const boxName = getTypeDisplayName('box');
  const lineName = getTypeDisplayName('line');
  const groups = headers();
  assert.deepEqual(groups.map(([label]) => label),
    ['Architect', boxName, 'Engineer', lineName].sort((x, y) => x.localeCompare(y)));
  assert.deepEqual(Object.fromEntries(groups), { Architect: 2, Engineer: 1, [lineName]: 1, [boxName]: 1 });
  // Within a group, rows keep page order.
  assert.deepEqual(rowIds().slice(0, 2), ['c', 'a']);
  const row = store.items().find(item => item.id === 'b');
  assert.equal(row.subjectLabel, boxName);
  assert.equal(row.subject, '', 'the own subject stays blank (the saver writes no subject)');
});

test('collapsing a subject group hides its rows; Group By is remembered', () => {
  showList();
  openDoc([box('a', { subject: 'Architect' }), box('b', { subject: 'Engineer' })]);
  list.updateAnnotationsList();
  store.toggleGroup('Architect');
  assert.equal(store.collapsedGroups().has('Architect'), true);
  store.expandAllGroups();
  store.setSortMode('author');
  assert.equal(globalThis.localStorage.getItem('ocudraw.markups.groupBy.v1'), 'author');
  store.setSortMode('subject');
});

test('Lock, Date and Color cells; the Date and Lock columns sort', () => {
  showList();
  openDoc([
    box('old', { subject: 'S', modifiedAt: '2026-01-02T10:00:00Z', locked: true, strokeColor: '#00ff00' }),
    box('new', { subject: 'S', modifiedAt: '2026-09-02T10:00:00Z', color: '#ff0000' }),
    box('mid', { subject: 'S', modifiedAt: '2026-05-02T10:00:00Z', readOnly: true }),
  ]);
  list.updateAnnotationsList();
  const row = id => store.items().find(item => item.id === id);
  assert.equal(row('old').ownLock, true);
  assert.equal(row('mid').ownLock, false, 'read-only is not the markup\'s own lock');
  assert.equal(row('mid').locked, true);
  assert.equal(row('new').color, '#ff0000');
  assert.equal(row('old').color, '#00ff00');
  assert.ok(row('new').date && row('new').date !== row('old').date);

  store.setColumnSort({ column: 'date', direction: 'ascending' });
  list.updateAnnotationsList();
  assert.deepEqual(rowIds(), ['old', 'mid', 'new']);
  store.setColumnSort({ column: 'date', direction: 'descending' });
  list.updateAnnotationsList();
  assert.deepEqual(rowIds(), ['new', 'mid', 'old']);
  store.setColumnSort({ column: 'lock', direction: 'descending' });
  list.updateAnnotationsList();
  assert.equal(rowIds()[0], 'old');
  store.setColumnSort(null);
});
