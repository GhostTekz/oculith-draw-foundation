import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedUndoPdfBytes, trimUndoStack } from './undo-byte-budget.js';

const page = (oldBytes, newBytes) => ({ type: 'pageStructure', oldBytes, newBytes });

test('page history is bounded by bytes even below the command-count limit', () => {
  const a = new Uint8Array(6);
  const b = new Uint8Array(6);
  const c = new Uint8Array(6);
  const history = [page(a, b), page(b, c)];
  assert.equal(retainedUndoPdfBytes(history), 18);
  assert.equal(trimUndoStack(history, 100, 12), 1);
  assert.equal(history.length, 1);
  assert.equal(retainedUndoPdfBytes(history), 12);
});

test('the latest oversized page edit remains undoable', () => {
  const history = [page(new Uint8Array(10), new Uint8Array(10))];
  assert.equal(trimUndoStack(history, 100, 8), 0);
  assert.equal(history.length, 1);
});

test('compound commands and shared backing buffers count once', () => {
  const buffer = new ArrayBuffer(16);
  const one = new Uint8Array(buffer, 0, 8);
  const two = new Uint8Array(buffer, 8, 8);
  const history = [{ type: 'compound', commands: [page(one, two)] }];
  assert.equal(retainedUndoPdfBytes(history), 16);
});
