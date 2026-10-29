import assert from 'node:assert/strict';
import test from 'node:test';
import { addSelectPointerObserver, notifySelectPointerMove } from './extension-overlay.js';

test('select pointer observation is read-only, isolated, and removable', () => {
  const seen = [];
  const removeBad = addSelectPointerObserver((point) => {
    seen.push(point);
    assert.equal(Object.isFrozen(point), true);
    throw new Error('isolated observer');
  });
  const removeGood = addSelectPointerObserver((point) => seen.push(point));
  const warning = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  try {
    notifySelectPointerMove({ x: NaN, y: 1, pageNumber: 1 });
    assert.equal(seen.length, 0);
    notifySelectPointerMove({ x: 5, y: 7, pageNumber: 2, documentId: 'drawing', idle: true });
    assert.equal(warned, 1);
    assert.deepEqual(seen, [
      { x: 5, y: 7, pageNumber: 2, documentId: 'drawing', idle: true },
      { x: 5, y: 7, pageNumber: 2, documentId: 'drawing', idle: true },
    ]);
  } finally {
    console.warn = warning;
    removeBad();
    removeGood();
  }
  notifySelectPointerMove({ x: 5, y: 7, pageNumber: 2 });
  assert.equal(seen.length, 2);
});
