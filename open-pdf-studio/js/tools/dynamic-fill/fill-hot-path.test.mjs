// Pointer hot path stays off GEOS. Paint already refuses polygonize in
// session.test.mjs; this file checks the snap function and the fill worker,
// then times the live area of the 20 ft by 15 ft room with its column hole.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { calculateArea } = await import('../../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../../annotations/scale-region.js');
const { performSnap } = await import('../snap-engine.js');
const { COLUMN, PT_PER_FT, ROOM_A } = await import('./floor-plan.testhulp.mjs');

const AREA_CALLS = 200;
// Five fresh runs on this machine finished the loop in 6.06–8.36 ms.
// 40 ms still fails a real stall and stays under the 250 ms ceiling.
const AREA_BUDGET_MS = 40;

function ring(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

test('performSnap and the fill worker do not call GEOS', () => {
  const snap = performSnap.toString();
  assert.match(snap, /^function performSnap\(/);
  assert.doesNotMatch(snap, /geos_/);
  const worker = readFileSync(new URL('./fill-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /geos_/);
  assert.doesNotMatch(worker, /exactClosedFace/);
  assert.doesNotMatch(worker, /fill-exact/);
});

test('the 20 ft by 15 ft room with the column hole stays 95904 page points squared', (t) => {
  assert.equal(ROOM_A.w, 20 * PT_PER_FT);
  assert.equal(ROOM_A.h, 15 * PT_PER_FT);
  assert.equal(COLUMN.w * COLUMN.h, 4 * PT_PER_FT * PT_PER_FT);
  state.documents = [{
    id: 'perf-01-area',
    currentPage: 1,
    annotations: [],
    measureScale: { pixelsPerUnit: PT_PER_FT, unit: 'ft' },
  }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureRounding = 'none';
  invalidateScaleRegionCache();
  const room = ring(ROOM_A.x, ROOM_A.y, ROOM_A.w, ROOM_A.h);
  const hole = ring(COLUMN.x, COLUMN.y, COLUMN.w, COLUMN.h);
  let area;
  const t0 = performance.now();
  for (let i = 0; i < AREA_CALLS; i++) area = calculateArea(room, [hole], 1);
  const ms = performance.now() - t0;
  t.diagnostic(`calculateArea x${AREA_CALLS} ${ms.toFixed(2)} ms`);
  assert.equal(area.pixels, 95904);
  assert.equal(area.pixels, ROOM_A.w * ROOM_A.h - COLUMN.w * COLUMN.h);
  assert.ok(ms < AREA_BUDGET_MS, `calculateArea x${AREA_CALLS} took ${ms} ms`);
});
