import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { clearGroupNetCache, refineScheduleGroupNet, scheduleWithGroupNet } = await import('./group-net.js');

const square = (x, y, size) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const cfg = { categories: ['area'], fields: ['area'], itemize: true };

function areaOf(row) {
  return row.vals.area;
}

test('overlapping polygons on one page count once, and each row stays its own area', async () => {
  clearGroupNetCache();
  const left = { type: 'filledArea', page: 1, points: square(0, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  const right = { type: 'filledArea', page: 1, points: square(0.5, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  let calls = 0;
  const scheduled = await refineScheduleGroupNet([left, right], cfg, (command, payload) => {
    calls += 1;
    assert.equal(command, 'geos_group_net_area');
    assert.equal(payload.shapes.length, 2);
    return 1.5;
  });
  assert.equal(calls, 1);
  assert.equal(scheduled.grandTotals.area, 1.5);
  assert.equal(scheduled.groups[0].subtotals.area, 1.5);
  assert.deepEqual(scheduled.groups[0].rows.map(areaOf), [1, 1]);
});

test('a box shares the union and a circle keeps the arithmetic sum', async () => {
  clearGroupNetCache();
  const box = { type: 'box', page: 1, x: 0, y: 0, width: 1, height: 1, __pxPerUnit: 1, __unit: 'pt' };
  const polygon = { type: 'polygon', page: 1, points: square(0.5, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  const scheduled = await refineScheduleGroupNet([box, polygon], cfg, (_command, payload) => {
    const rings = payload.shapes.map((shape) => shape.parts[0]);
    assert.equal(rings.length, 2);
    assert.deepEqual(rings[0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    return 1.5;
  });
  assert.equal(scheduled.grandTotals.area, 1.5);
  assert.equal(scheduled.groups[0].rows[0].vals.area, 1);

  clearGroupNetCache();
  let calls = 0;
  const mixed = await refineScheduleGroupNet([
    polygon,
    { type: 'circle', page: 1, x: 0, y: 0, width: 2, height: 2, __pxPerUnit: 1, __unit: 'pt' },
  ], cfg, () => { calls += 1; return 1; });
  assert.equal(calls, 0);
  assert.ok(mixed.grandTotals.area > 1);
});

test('separate pages, a cloud, and a missing command keep the row sum', async () => {
  clearGroupNetCache();
  const pageA = { type: 'filledArea', page: 1, points: square(0, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  const pageB = { type: 'filledArea', page: 2, points: square(0, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  let calls = 0;
  const pages = await refineScheduleGroupNet([pageA, pageB], cfg, () => { calls += 1; return 1; });
  assert.equal(calls, 0);
  assert.equal(pages.grandTotals.area, 2);

  clearGroupNetCache();
  const cloud = await refineScheduleGroupNet([
    pageA,
    { type: 'cloud', page: 1, x: 0, y: 0, width: 2, height: 2, __pxPerUnit: 1, __unit: 'pt' },
  ], cfg, () => { calls += 1; return 1; });
  assert.equal(calls, 0);
  assert.equal(cloud.grandTotals.area, 1 + 4);

  clearGroupNetCache();
  const offline = await refineScheduleGroupNet([pageA, { ...pageA }], cfg, () => {
    throw new Error('geometry engine is not linked');
  });
  assert.equal(offline.grandTotals.area, 2);
});

test('a live drag does not ask for a group union', () => {
  clearGroupNetCache();
  state.isDragging = true;
  const left = { type: 'filledArea', page: 1, points: square(0, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  const right = { type: 'filledArea', page: 1, points: square(0.5, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  let calls = 0;
  try {
    const scheduled = scheduleWithGroupNet([left, right], cfg, () => { calls += 1; return 1.5; });
    assert.equal(calls, 0);
    assert.equal(scheduled.grandTotals.area, 2);
  } finally {
    state.isDragging = false;
  }
});

test('the browser schedule does not ask for a group union', () => {
  clearGroupNetCache();
  const left = { type: 'filledArea', page: 1, points: square(0, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  const right = { type: 'filledArea', page: 1, points: square(0.5, 0, 1), __pxPerUnit: 1, __unit: 'pt' };
  const scheduled = scheduleWithGroupNet([left, right], cfg);
  assert.equal(scheduled.grandTotals.area, 2);
});

test('two labels on one page union in the grand total and keep their own subtotals', async () => {
  clearGroupNetCache();
  const room = (label, x) => ({
    type: 'filledArea', page: 1, label, points: square(x, 0, 1), __pxPerUnit: 1, __unit: 'pt',
  });
  const scheduled = await refineScheduleGroupNet(
    [room('A', 0), room('B', 0.5)],
    { ...cfg, sort: [{ field: 'label', dir: 'asc', group: true }] },
    () => 1.5,
  );
  assert.equal(scheduled.grandTotals.area, 1.5);
  assert.deepEqual(scheduled.groups.map((group) => group.subtotals.area), [1, 1]);
});

test('area measurements on a shared scale convert the union from page points', async () => {
  clearGroupNetCache();
  state.documents = [{ id: 'group-net', currentPage: 1, annotations: [], measureScale: { pixelsPerUnit: 1, unit: 'm' } }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  const measure = (x) => ({
    type: 'measureArea',
    page: 1,
    points: square(x, 0, 1),
    measureValue: 1,
    measureUnit: 'm²',
  });
  const scheduled = await refineScheduleGroupNet([measure(0), measure(0.5)], cfg, () => 1.5);
  assert.equal(scheduled.grandTotals.area, 1.5);
  assert.deepEqual(scheduled.groups[0].rows.map(areaOf), [1, 1]);
});

test('an external-file measurement stays out of the union', async () => {
  clearGroupNetCache();
  let calls = 0;
  const scheduled = await refineScheduleGroupNet([
    { type: 'measureArea', page: 1, points: square(0, 0, 1), measureValue: 4, measureUnit: 'm²', extMeasure: true },
    { type: 'measureArea', page: 1, points: square(0, 0, 1), measureValue: 4, measureUnit: 'm²', extMeasure: true },
  ], cfg, () => { calls += 1; return 1; });
  assert.equal(calls, 0);
  assert.equal(scheduled.grandTotals.area, 8);
});
