// metWeergaveDoorloop (view-filters.js): within one pass over the markups the
// view filters are read once. The answers must equal the per-markup check, and
// a filter changed between two passes must count in the next pass.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { isAnnotationHiddenInView, metWeergaveDoorloop } = await import('./view-filters.js');
const { setTypeHidden } = await import('../solid/stores/elementVisibilityStore.js');

const markeringen = [
  { id: 'a', type: 'box', page: 1 },
  { id: 'b', type: 'box', page: 1, hidden: true },
  { id: 'c', type: 'circle', page: 1 },
  { id: 'd', type: 'line', page: 1 },
];

function doc() {
  state.documents = [{ annotations: markeringen, annotationLayers: [] }];
  state.activeDocumentIndex = 0;
}

test('the batched pass answers exactly like the per-markup check', () => {
  doc();
  setTypeHidden('circle', true);
  try {
    const los = markeringen.map((m) => isAnnotationHiddenInView(m));
    const inDoorloop = metWeergaveDoorloop(() => markeringen.map((m) => isAnnotationHiddenInView(m)));
    assert.deepEqual(inDoorloop, los);
    assert.deepEqual(los, [false, true, true, false]);
  } finally {
    setTypeHidden('circle', false);
  }
});

test('a filter changed between two passes counts in the next pass', () => {
  doc();
  const eerst = metWeergaveDoorloop(() => markeringen.map((m) => isAnnotationHiddenInView(m)));
  setTypeHidden('line', true);
  try {
    const daarna = metWeergaveDoorloop(() => markeringen.map((m) => isAnnotationHiddenInView(m)));
    assert.deepEqual(eerst, [false, true, false, false]);
    assert.deepEqual(daarna, [false, true, false, true]);
  } finally {
    setTypeHidden('line', false);
  }
});

test('nested passes reuse the outer one and the state is cleared afterwards', () => {
  doc();
  const r = metWeergaveDoorloop(() => metWeergaveDoorloop(() => isAnnotationHiddenInView(markeringen[1])));
  assert.equal(r, true);
  setTypeHidden('box', true);
  try {
    assert.equal(isAnnotationHiddenInView(markeringen[0]), true, 'outside a pass the live filters apply');
  } finally {
    setTypeHidden('box', false);
  }
});
