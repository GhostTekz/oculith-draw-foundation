import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDrawLookup, visibleDrawItems } from './draw-lookup.js';

test('viewport candidates keep markup paint order and never lose unindexed marks', () => {
  const annotations = [
    { id: 'far', page: 1 },
    { id: 'near', page: 1 },
    { page: 1, type: 'unsupported' },
    { id: 'other-page', page: 2 },
    { id: 'above', page: 1 },
  ];
  const index = {
    rebuild() {},
    has(id) { return id !== 'other-page'; },
    query() { return new Set(['above', 'near']); },
  };
  const lookup = buildDrawLookup(annotations, index);
  assert.deepEqual(visibleDrawItems(index, lookup, 1, 0, 0, 100, 100, []),
    [annotations[1], annotations[2], annotations[4]]);
  assert.deepEqual(visibleDrawItems(index, lookup, 1, 0, 0, 100, 100, [annotations[0]]),
    [annotations[0], annotations[1], annotations[2], annotations[4]]);
});

test('duplicate markup IDs remain in their original order', () => {
  const annotations = [{ id: 'same', page: 1, z: 1 }, { id: 'same', page: 1, z: 2 }];
  const index = { rebuild() {}, has() { return true; }, query() { return new Set(['same']); } };
  const lookup = buildDrawLookup(annotations, index);
  assert.deepEqual(visibleDrawItems(index, lookup, 1, 0, 0, 100, 100, []), annotations);
});
