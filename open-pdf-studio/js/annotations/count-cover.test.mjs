import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { markupSpaceResolver } = await import('../spaces/model.js');
const { confirmCountCover, scheduleCountCover } = await import('./count-cover.js');

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function spaceDoc(annotation) {
  return {
    id: 'count-cover',
    currentPage: 1,
    spaces: [{ id: 'square', page: 1, name: 'Room', points: square.map((point) => ({ ...point })) }],
    annotations: annotation ? [annotation] : [],
  };
}

function countAt(x, y) {
  return { type: 'count', page: 1, x, y };
}

test('a count inside the JavaScript space stays there when the engine covers it', async () => {
  const annotation = countAt(5, 5);
  const doc = spaceDoc(annotation);
  const resolve = markupSpaceResolver(doc);
  let calls = 0;
  const changed = await confirmCountCover(annotation, doc, (command, args) => {
    calls += 1;
    assert.equal(command, 'geos_covers');
    assert.deepEqual(args, {
      ring: [[0, 0], [10, 0], [10, 10], [0, 10]],
      x: 5,
      y: 5,
    });
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(changed, false);
  assert.notEqual(annotation.engineOutsideSpace, true);
  const space = resolve(annotation);
  assert.equal(space?.id, 'square');
  assert.equal(space?.name, 'Room');
});

test('an engine miss marks the count outside the space JavaScript picked', async () => {
  const annotation = countAt(5, 5);
  const doc = spaceDoc(annotation);
  const resolve = markupSpaceResolver(doc);
  assert.equal(resolve(annotation)?.id, 'square');
  let calls = 0;
  const changed = await confirmCountCover(annotation, doc, () => {
    calls += 1;
    return false;
  });
  assert.equal(calls, 1);
  assert.equal(changed, true);
  assert.equal(annotation.engineOutsideSpace, true);
  assert.equal(resolve(annotation), null);
});

test('a thrown geometry command leaves the point-in-polygon result', async () => {
  const annotation = countAt(5, 5);
  const doc = spaceDoc(annotation);
  let calls = 0;
  const changed = await confirmCountCover(annotation, doc, () => {
    calls += 1;
    throw new Error('geometry engine is not linked');
  });
  assert.equal(calls, 1);
  assert.equal(changed, false);
  assert.equal(annotation.engineOutsideSpace, undefined);
  assert.equal(markupSpaceResolver(doc)(annotation)?.id, 'square');
});

test('a count outside the square does not ask the engine', async () => {
  const annotation = countAt(20, 20);
  const doc = spaceDoc(annotation);
  let calls = 0;
  const changed = await confirmCountCover(annotation, doc, () => {
    calls += 1;
    return false;
  });
  assert.equal(calls, 0);
  assert.equal(changed, false);
  assert.notEqual(annotation.engineOutsideSpace, true);
  assert.equal(markupSpaceResolver(doc)(annotation), null);
});

test('a line annotation does not ask the engine', async () => {
  const annotation = { type: 'line', page: 1, startX: 1, startY: 1, endX: 9, endY: 9 };
  const doc = spaceDoc(annotation);
  let calls = 0;
  const changed = await confirmCountCover(annotation, doc, () => {
    calls += 1;
    return false;
  });
  assert.equal(calls, 0);
  assert.equal(changed, false);
  assert.equal(annotation.engineOutsideSpace, undefined);
});

test('scheduleCountCover without the desktop command does not set the flag', () => {
  const annotation = countAt(5, 5);
  const doc = spaceDoc(annotation);
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  const previous = globalThis.window.__TAURI__;
  delete globalThis.window.__TAURI__;
  try {
    scheduleCountCover([annotation]);
  } finally {
    if (previous === undefined) delete globalThis.window.__TAURI__;
    else globalThis.window.__TAURI__ = previous;
  }
  assert.notEqual(annotation.engineOutsideSpace, true);
});
