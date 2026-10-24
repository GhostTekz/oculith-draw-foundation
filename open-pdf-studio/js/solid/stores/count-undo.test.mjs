import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../core/state.ts');
const { createAnnotationFromTool } = await import('../../tools/annotation-creators.js');
const { setActiveCountCategory, nextCountNumber } = await import('./countStore.js');
const { recordAdd, undo, redo, canRedo } = await import('../../core/undo-manager.js');

function openDocument(annotations = []) {
  state.documents = [{
    id: 'count-undo-test', filePath: null, pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, modified: false,
    textEdits: [], watermarks: [], bookmarks: [], pageRotations: {}, measureScale: null,
  }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

function place(doc, categoryId, x) {
  setActiveCountCategory(categoryId);
  const marker = createAnnotationFromTool('count', x, 20, x, 20);
  doc.annotations.push(marker);
  recordAdd(marker);
  return marker;
}

function numbers(doc, categoryId) {
  return doc.annotations.filter(a => a.type === 'count' && a.categoryId === categoryId)
    .map(a => a.number);
}

test('undo, redo, and divergent add keep each category sequence independent', async () => {
  const doc = openDocument();
  assert.equal(place(doc, 'deuren', 10).number, 1);
  assert.equal(place(doc, 'ramen', 20).number, 1);
  assert.equal(place(doc, 'deuren', 30).number, 2);
  assert.deepEqual(numbers(doc, 'deuren'), [1, 2]);
  assert.deepEqual(numbers(doc, 'ramen'), [1]);

  await undo();
  assert.deepEqual(numbers(doc, 'deuren'), [1]);
  assert.equal(nextCountNumber('deuren'), 2);
  assert.equal(nextCountNumber('ramen'), 2);

  await redo();
  assert.deepEqual(numbers(doc, 'deuren'), [1, 2]);
  assert.equal(nextCountNumber('deuren'), 3);
  assert.equal(nextCountNumber('ramen'), 2);

  await undo();
  assert.equal(place(doc, 'deuren', 40).number, 2);
  assert.equal(canRedo(), false, 'a new marker clears the old redo branch');
  assert.equal(place(doc, 'ramen', 50).number, 2);
  assert.deepEqual(numbers(doc, 'deuren'), [1, 2]);
  assert.deepEqual(numbers(doc, 'ramen'), [1, 2]);
});

test('saved sparse numbers stay unique through undo and redo in either category', async () => {
  const doc = openDocument([
    { id: 'door-1', type: 'count', categoryId: 'deuren', number: 1, page: 1, x: 1, y: 1 },
    { id: 'door-3', type: 'count', categoryId: 'deuren', number: 3, page: 1, x: 3, y: 1 },
    { id: 'window-1', type: 'count', categoryId: 'ramen', number: 1, page: 1, x: 5, y: 1 },
  ]);
  assert.equal(place(doc, 'deuren', 60).number, 4);
  assert.equal(place(doc, 'ramen', 70).number, 2);
  assert.deepEqual(numbers(doc, 'deuren'), [1, 3, 4]);
  assert.deepEqual(numbers(doc, 'ramen'), [1, 2]);
  await undo();
  assert.deepEqual(numbers(doc, 'ramen'), [1]);
  assert.equal(nextCountNumber('deuren'), 5);
  assert.equal(nextCountNumber('ramen'), 2);
  await redo();
  assert.deepEqual(numbers(doc, 'ramen'), [1, 2]);
  assert.equal(nextCountNumber('deuren'), 5);
  assert.equal(nextCountNumber('ramen'), 3);
});
