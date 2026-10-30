// Markups List header count: the bottom dock shows the count in its header
// even while the list is collapsed. A measurement drawn with the dock closed
// must still update it (the hidden list skips building rows, #491, but not
// the count): after one Distance the header said "0 annotations" while the
// status bar said 1.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { list, store, leftPanel } = await import('./annotations-list.testhulp.mjs');
const { countText, items } = store;
const { activeTab, setActiveTab, collapsed, setCollapsed } = leftPanel;
// The Markups List sits in the bottom panel host; collapsing that host hides it.
const hideList = () => { setActiveTab('annotations'); setCollapsed(true); };
const { updateAnnotationsList } = list;

function openDoc(annotations) {
  state.documents = [{ id: `dock-${Math.random()}`, currentPage: 1, viewMode: 'single',
    annotations, selectedAnnotations: [] }];
  state.activeDocumentIndex = 0;
}
const distance = (id) => ({ id, type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 72, endY: 0,
  measureText: '10\'-0"', createdAt: '2026-10-14T00:00:00Z' });

test('a collapsed Markups List still counts a new measurement', () => {
  hideList();
  openDoc([]);
  updateAnnotationsList();
  assert.equal(countText(), '0 annotations');
  state.documents[0].annotations.push(distance('m1'));
  updateAnnotationsList();
  assert.equal(countText(), '1 annotation', 'the dock header follows the new measurement');
  assert.equal(items().length, 0, 'the hidden list still does not build its rows');
});

test('the count matches the rows once the list is shown', () => {
  openDoc([distance('m1'), distance('m2'), { id: 'vp', type: 'scaleRegion', page: 1 }]);
  hideList();
  updateAnnotationsList();
  assert.equal(countText(), '2 annotations', 'named viewports are not markups');
  setActiveTab('annotations');
  if (collapsed()) setCollapsed(false);
  updateAnnotationsList();
  assert.equal(countText(), '2 annotations');
  assert.ok(items().length >= 2);
  assert.equal(activeTab(), 'annotations');
});
