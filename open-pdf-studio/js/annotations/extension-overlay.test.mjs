import assert from 'node:assert/strict';
import test from 'node:test';
import { addExtensionUnderlay, drawExtensionUnderlays } from './extension-overlay.js';

test('underlay callbacks receive the page and document inside an isolated viewport clip', () => {
  const calls = [];
  const matrix = { a: 2, b: 0, c: 0, d: 2, e: 15, f: 20 };
  const ctx = {
    canvas: { width: 400, height: 300 },
    save: () => calls.push('save'), restore: () => calls.push('restore'),
    getTransform: () => matrix, setTransform: (...args) => calls.push(['transform', ...args]),
    beginPath: () => calls.push('path'), rect: (...args) => calls.push(['rect', ...args]),
    clip: () => calls.push('clip'),
  };
  const doc = { id: 'drawing' };
  const remove = addExtensionUnderlay((actual, page, source) => {
    assert.equal(actual, ctx);
    assert.equal(page, 2);
    assert.equal(source, doc);
    calls.push('draw');
  });
  try {
    drawExtensionUnderlays(ctx, 2, doc);
    assert.deepEqual(calls, ['save', ['transform', 1, 0, 0, 1, 0, 0], 'path',
      ['rect', 0, 0, 400, 300], 'clip', ['transform', matrix], 'draw', 'restore']);
  } finally { remove(); }
  calls.length = 0;
  drawExtensionUnderlays(ctx, 2, doc);
  assert.deepEqual(calls, []);
});

test('a failed underlay cannot stop the next contribution', () => {
  const calls = [];
  const ctx = { canvas: { width: 1, height: 1 }, save: () => calls.push('save'),
    restore: () => calls.push('restore'), getTransform: () => ({}),
    setTransform: () => {}, beginPath: () => {}, rect: () => {}, clip: () => {} };
  const removeBad = addExtensionUnderlay(() => { throw new Error('bad add-on'); });
  const removeGood = addExtensionUnderlay(() => calls.push('next'));
  const warn = console.warn;
  console.warn = () => {};
  try {
    drawExtensionUnderlays(ctx, 1, null);
    assert.deepEqual(calls, ['save', 'restore', 'save', 'next', 'restore']);
  } finally {
    console.warn = warn;
    removeGood();
    removeBad();
  }
});
