import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const {
  cutToCrossing,
  openPathOf,
  refineCross,
  refineSplit,
  scheduleCrossRefine,
  segmentCrossings,
  splitAtCrossing,
  splitAtPoint,
  trimPair,
} = await import('./path-cross.js');

function line(id, x1, y1, x2, y2) {
  return { id, type: 'line', startX: x1, startY: y1, endX: x2, endY: y2 };
}

function poly(id, points) {
  return { id, type: 'polyline', points: points.map(([x, y]) => ({ x, y })) };
}

function xy(points) {
  return points.map((point) => [point.x, point.y]);
}

test('two straight lines meet past the segment and do not ask the engine', () => {
  const target = line('t', 0, 0, 4, 0);
  const cutter = line('c', 6, -2, 6, 4);
  assert.deepEqual(segmentCrossings(
    [{ x: 0, y: 0 }, { x: 4, y: 0 }],
    [{ x: 6, y: -2 }, { x: 6, y: 4 }],
  ), []);
  const cut = trimPair(target, cutter, { x: 3, y: 0 });
  assert.ok(cut);
  assert.equal(target.crossPending, undefined);
  assert.deepEqual([target.startX, target.startY, target.endX, target.endY], [0, 0, 6, 0]);
  assert.deepEqual([cutter.startX, cutter.startY, cutter.endX, cutter.endY], [6, 0, 6, 4]);
  assert.equal(cut.oldTarget.endX, 4);
  assert.equal(cut.oldCutter.startY, -2);
});

test('a click on a straight line keeps the far end at the crossing', () => {
  const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const kept = cutToCrossing(path, { x: 8, y: 0 }, { x: 5, y: 0 });
  assert.deepEqual(xy(kept), [[0, 0], [5, 0]]);
});

test('a longer path is cut on the side nearest the click', () => {
  const target = poly('t', [[0, 0], [10, 0], [10, 10]]);
  const cutter = poly('c', [[4, -2], [4, 4], [8, 4]]);
  const cut = trimPair(target, cutter, { x: 8, y: 0.2 });
  assert.ok(cut);
  assert.deepEqual(xy(target.points), [[0, 0], [4, 0]]);
  assert.deepEqual(xy(cutter.points), [[4, -2], [4, 0]]);
  assert.equal(target.crossPending.cutterId, 'c');
  assert.deepEqual(target.crossPending.jsPoint, [4, 0]);
  assert.equal(cutter.crossPending, undefined);

  const other = poly('t2', [[0, 0], [5, 0], [10, 0]]);
  const wall = line('w', 6, -1, 6, 1);
  const back = trimPair(other, wall, { x: 2, y: 0 });
  assert.ok(back);
  assert.deepEqual(xy(other.points), [[6, 0], [10, 0]]);
  assert.deepEqual([wall.startX, wall.startY, wall.endX, wall.endY], [6, -1, 6, 0]);
});

test('parallel paths are left unchanged', () => {
  const target = poly('t', [[0, 0], [5, 0], [10, 0]]);
  const cutter = poly('c', [[0, 1], [10, 1]]);
  const before = JSON.stringify(target);
  assert.equal(trimPair(target, cutter, { x: 4, y: 0 }), null);
  assert.equal(JSON.stringify(target), before);
  assert.equal(target.crossPending, undefined);
});

test('the engine crossing replaces the segment cut on both paths', async () => {
  state.documents = [{ id: 'trim-doc', annotations: [], currentPage: 1 }];
  state.activeDocumentIndex = 0;
  const target = poly('t', [[0, 0], [4, 0]]);
  const cutter = poly('c', [[5, -2], [5, 8]]);
  target.crossPending = {
    cutterId: 'c',
    targetPath: [[0, 0], [10, 0], [10, 10]],
    cutterPath: [[5, -2], [5, 8]],
    x: 8,
    y: 0,
    jsPoint: [4, 0],
  };
  state.documents[0].annotations = [target, cutter];
  const changed = await refineCross(target, async () => [[5, 0]]);
  assert.equal(changed, true);
  assert.equal(target.crossPending, undefined);
  assert.deepEqual(xy(target.points), [[0, 0], [5, 0]]);
  assert.deepEqual(xy(cutter.points), [[5, -2], [5, 0]]);
});

test('a missing command leaves the segment cut and clears the request', async () => {
  const target = poly('t', [[0, 0], [4, 0]]);
  target.crossPending = {
    cutterId: 'c',
    targetPath: [[0, 0], [10, 0]],
    cutterPath: [[4, -1], [4, 1]],
    x: 8,
    y: 0,
    jsPoint: [4, 0],
  };
  const thrown = await refineCross(target, async () => {
    throw new Error('geometry engine is not linked');
  });
  assert.equal(thrown, false);
  assert.equal(target.crossPending, undefined);
  assert.deepEqual(xy(target.points), [[0, 0], [4, 0]]);

  target.crossPending = {
    cutterId: 'c',
    targetPath: [[0, 0], [10, 0]],
    cutterPath: [[4, -1], [4, 1]],
    x: 8,
    y: 0,
    jsPoint: [4, 0],
  };
  const same = await refineCross(target, async () => [[4, 0]]);
  assert.equal(same, false);
  assert.equal(target.crossPending, undefined);
  assert.deepEqual(xy(target.points), [[0, 0], [4, 0]]);
});

test('without the desktop command a pending trim is dropped', () => {
  const target = poly('t', [[0, 0], [4, 0]]);
  target.crossPending = { cutterId: 'c', targetPath: [[0, 0], [4, 0]], cutterPath: [[4, -1], [4, 1]] };
  const win = globalThis.window || {};
  globalThis.window = win;
  const previous = win.__TAURI__;
  delete win.__TAURI__;
  try {
    scheduleCrossRefine([target]);
  } finally {
    if (previous === undefined) delete win.__TAURI__;
    else win.__TAURI__ = previous;
  }
  assert.equal(target.crossPending, undefined);
  assert.deepEqual(xy(target.points), [[0, 0], [4, 0]]);
});

test('an open polyline splits at a click and at a crossing', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  const atClick = splitAtPoint(path, { x: 6, y: 0 });
  assert.deepEqual(xy(atClick.head), [[0, 0], [6, 0]]);
  assert.deepEqual(xy(atClick.tail), [[6, 0], [10, 0], [10, 10]]);
  assert.equal(splitAtPoint(path, { x: 0, y: 0 }), null);

  const crossed = splitAtCrossing(path, [{ x: 4, y: -1 }, { x: 4, y: 3 }], { x: 4, y: 2 });
  assert.deepEqual(xy(crossed.head), [[0, 0], [4, 0]]);
  assert.deepEqual(xy(crossed.tail), [[4, 0], [10, 0], [10, 10]]);
  assert.equal(splitAtCrossing(path, [{ x: 0, y: 2 }, { x: 8, y: 2 }], { x: 3, y: 2 }), null);

  const closed = poly('closed', [[0, 0], [4, 0], [4, 4], [0, 0]]);
  assert.equal(openPathOf(closed), null);
  const open = poly('open', [[0, 0], [4, 0], [4, 4]]);
  assert.equal(openPathOf(open).length, 3);
});

test('the engine crossing moves both pieces of a polyline split', async () => {
  state.documents = [{ id: 'split-doc', annotations: [], currentPage: 1 }];
  state.activeDocumentIndex = 0;
  const target = poly('t', [[0, 0], [4, 0]]);
  const tail = poly('tail', [[4, 0], [10, 0], [10, 10]]);
  target.splitPending = {
    tailId: 'tail',
    cutterId: 'c',
    targetPath: [[0, 0], [10, 0], [10, 10]],
    cutterPath: [[5, -1], [5, 1]],
    x: 8,
    y: 0,
    jsPoint: [4, 0],
  };
  state.documents[0].annotations = [target, tail];
  const changed = await refineSplit(target, async () => [[5, 0]]);
  assert.equal(changed, true);
  assert.equal(target.splitPending, undefined);
  assert.deepEqual(xy(target.points), [[0, 0], [5, 0]]);
  assert.deepEqual(xy(tail.points), [[5, 0], [10, 0], [10, 10]]);

  target.points = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  tail.points = [{ x: 4, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  target.splitPending = {
    tailId: 'tail',
    targetPath: [[0, 0], [10, 0], [10, 10]],
    cutterPath: [[4, -1], [4, 1]],
    x: 8,
    y: 0,
    jsPoint: [4, 0],
  };
  const thrown = await refineSplit(target, async () => {
    throw new Error('geometry engine is not linked');
  });
  assert.equal(thrown, false);
  assert.equal(target.splitPending, undefined);
  assert.deepEqual(xy(target.points), [[0, 0], [4, 0]]);
  assert.deepEqual(xy(tail.points), [[4, 0], [10, 0], [10, 10]]);
});
