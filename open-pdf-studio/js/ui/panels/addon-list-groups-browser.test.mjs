// Exercise the actual Markups List store with a composed independent add-on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { composeAddons } = await import('../../editions/compose-addons.js');
const { edition: foundation } = await import('../../editions/community.js');
const selected = [];
const id = 'sample.tools';
const groupId = `addon:${id}:zone`;
const contribution = { apiVersion: 2, id, listGrouping: {
  paths: (_doc, annotations) => new Map(annotations.filter((ann) => ann.id === 'a')
    .map((ann) => [ann, { id: groupId, name: 'Zone', color: '#abc' }])),
  select: (key, ctrl) => selected.push([key, ctrl]),
} };
globalThis.__ocudrawEdition = composeAddons(foundation, [{ id, addon: contribution }]).edition;
const { state } = await import('../../core/state.js');
const { list, store, showList } = await import('./annotations-list.testhulp.mjs');

test('composed package group appears in the live list and owns selection and drop', async () => {
  const doc = { id: 'addon-list-test', filePath: null, currentPage: 1, viewMode: 'single',
    annotations: ['a', 'b'].map((id) => ({ id, type: 'box', page: 1, x: 0, y: 0,
      width: 5, height: 5, subject: 'Box', createdAt: '2026-10-01T00:00:00Z' })),
    selectedAnnotations: [], selectedAnnotation: null, undoStack: [], redoStack: [],
    savedUndoStackLength: 0, pdfDoc: { numPages: 1 }, pageRotations: {}, textEdits: [] };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  store.setSearchQuery('');
  store.setColumnSort(null);
  store.setSortMode('subject');
  store.expandAllGroups();
  store.setExpandedMarkupGroups(new Set());
  showList();
  list.updateAnnotationsList();
  const group = store.items().find((item) => item.isMarkupGroup && item.mgId === groupId);
  assert.equal(group?.name, 'Zone');
  assert.equal(store.items().find((item) => item.id === 'a')?.accentColor, '#abc');
  assert.equal(store.items().find((item) => item.id === 'b')?.accentColor || '', '');
  await list.selectMarkupGroupItem(groupId, true);
  assert.deepEqual(selected, [[groupId, true]]);
  assert.equal(await list.dropMarkupsOnCategory(['b'], { groupId }), 0);
  assert.equal(doc.annotations[1].groupId, undefined);
});
