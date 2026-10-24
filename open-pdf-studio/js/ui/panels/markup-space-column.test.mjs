// Markups List Space column (Spaces panel): the computed, read-only Space of
// every markup in the rows, Group By Space, the column filter, the search and
// the CSV/PDF/XML summaries. Moving a markup changes its row on the next build.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { list, store, showList } = await import('./annotations-list.testhulp.mjs');
const { markupCsv, markupSummaryRows } = await import('../../annotations/markup-csv.js');
const { markupSummaryXml } = await import('../../annotations/markup-xml.js');
const { fixture } = await import('../../spaces/spaces-fixture.testhulp.mjs');
const { FILTERABLE_COLUMNS } = await import('./markup-column-filter.js');

function open() {
  const doc = { ...fixture(), viewMode: 'single', selectedAnnotations: [] };
  for (const a of doc.annotations) Object.assign(a, { author: 'A', createdAt: '2026-10-01T00:00:00Z' });
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  store.setColumnFilters({});
  store.setColumnSort(null);
  store.setSearchQuery('');
  store.setSortMode('page');
  return state.documents[0];
}
const rows = () => store.items().filter(i => !i.isHeader && !i.isReply);
const spaceById = () => Object.fromEntries(rows().map(i => [i.id, i.spaceName]));

test('every row carries its Space; moving a markup updates it', () => {
  showList();
  const doc = open();
  list.updateAnnotationsList();
  assert.deepEqual(spaceById(), {
    kitchen: 'Kitchen', living: 'Living',
    m1: 'Kitchen', m2: 'Living', m3: 'Office ▸ Closet', m4: 'Office', m5: 'Living',
    m6: '', m7: 'Kitchen', m8: 'Office ▸ Closet', m9: 'Office', m10: '',
  });
  const m1 = doc.annotations.find(a => a.id === 'm1');
  m1.x = 355; m1.y = 555;
  list.updateAnnotationsList();
  assert.equal(spaceById().m1, 'Office ▸ Closet');
  m1.x = 90; m1.y = 90;
});

test('Group By Space: one group per space path, "(No Space)" last', () => {
  showList();
  open();
  store.setSortMode('space');
  list.updateAnnotationsList();
  const headers = store.items().filter(i => i.isHeader).map(i => i.headerLabel);
  assert.deepEqual(headers, ['Kitchen', 'Living', 'Office', 'Office ▸ Closet', '(No Space)']);
  const groupOf = Object.fromEntries(rows().map(i => [i.id, i.groupKey]));
  assert.equal(groupOf.m3, 'Office ▸ Closet');
  assert.equal(groupOf.m6, '');
  store.setSortMode('page');
});

test('the Space column filter and the search', () => {
  showList();
  open();
  assert.ok(FILTERABLE_COLUMNS.includes('space'));
  assert.deepEqual(list.markupColumnFilterValues('space').map(v => [v.value, v.count]),
    [['Kitchen', 3], ['Living', 3], ['Office', 2], ['Office ▸ Closet', 2], ['', 2]]);
  store.setColumnFilters({ space: ['Kitchen', 'Living', ''] });
  list.updateAnnotationsList();
  assert.deepEqual(rows().map(i => i.id).sort(), ['m3', 'm4', 'm8', 'm9']);
  store.setColumnFilters({});
  store.setSearchQuery('closet');
  list.updateAnnotationsList();
  assert.deepEqual(rows().map(i => i.id).sort(), ['m3', 'm8']);
  store.setSearchQuery('');
});

test('CSV, XML and PDF summary rows carry the Space when the document has spaces', () => {
  const doc = open();
  const spaceOf = list.markupSpaceNamer(doc);
  assert.equal(typeof spaceOf, 'function');
  const csv = markupCsv(doc.annotations, null, '', null, null, null, null, '', null, null, { spaceOf });
  const [header, ...lines] = csv.replace(/^﻿/u, '').trim().split('\r\n');
  assert.match(header, /"Space"$/u);
  assert.equal(lines.length, doc.annotations.length);
  assert.ok(lines.some(l => l.endsWith('"Office ▸ Closet"')));
  const summary = markupSummaryRows(doc.annotations, null, null, null, null, null, null, null, { spaceOf });
  assert.equal(summary.find(r => r.type && r.space === 'Office').space, 'Office');
  const xml = markupSummaryXml({ sourcePath: 'x.pdf', rows: summary, generatedAt: 0 });
  assert.match(xml, /space="Office ▸ Closet"/u);
  // Without spaces: no namer and no Space column (existing exports unchanged).
  assert.equal(list.markupSpaceNamer({ annotations: [], spaces: [] }), null);
  assert.doesNotMatch(markupCsv(doc.annotations).split('\r\n')[0], /Space/u);
});
