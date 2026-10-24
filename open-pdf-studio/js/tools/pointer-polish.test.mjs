// Click-to-place polish: the vertex just placed is not a point magnet, a
// click without extra targets reuses the snap the dispatcher already did,
// and a hover marker does not redraw the page when the snap point holds.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { DEFAULT_PREFERENCES } = await import('../core/constants.js');
const { zonderLaatstePunt, hergebruikKlikSnap, paintHoverSnap } = await import('./pointer-snap.js');
const { performSnap } = await import('./snap-engine.js');

function rustigeSnap() {
  state.preferences = {
    ...DEFAULT_PREFERENCES,
    enableObjectSnap: true,
    snapToPdfContent: false,
    snapToMarkup: false,
    enableGridSnap: false,
    snapToPerpendicular: false,
    snapToTangent: false,
    snapToNearest: false,
    snapToIntersections: false,
    objectSnapRadius: 12,
  };
  state.documents = [];
  state.activeDocumentIndex = -1;
}

test('the vertex just placed drops out of a magnet list and earlier vertices stay', () => {
  assert.deepEqual(zonderLaatstePunt([{ x: 1, y: 2 }]), []);
  assert.deepEqual(zonderLaatstePunt([]), []);
  assert.deepEqual(zonderLaatstePunt(null), []);
  assert.deepEqual(
    zonderLaatstePunt([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }]),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  );
});

test('a click with no extra targets reuses the dispatcher snap and keeps a miss on the cursor', () => {
  const calls = [];
  const ctx = {
    state: { lastSnapResult: { x: 4, y: 5, snapped: true, type: 'endpoint' } },
    snap(x, y, id, points) { calls.push({ x, y, id, points }); return { x: 9, y: 9, snapped: true }; },
  };
  assert.deepEqual(hergebruikKlikSnap(ctx, 1, 2, []), ctx.state.lastSnapResult);
  assert.equal(calls.length, 0);
  ctx.state.lastSnapResult = null;
  assert.deepEqual(hergebruikKlikSnap(ctx, 1, 2, null), { x: 1, y: 2, snapped: false });
  const doel = [{ x: 0, y: 0 }];
  assert.equal(hergebruikKlikSnap(ctx, 3, 4, doel).x, 9);
  assert.deepEqual(calls[0].points, doel);
});

test('hover snap redraws only when the snap point changes', () => {
  let redraws = 0;
  let indicators = 0;
  const snap = { x: 10, y: 20, snapped: true, type: 'endpoint' };
  const ctx = {
    state: { lastSnapResult: null },
    snap: () => snap,
    redraw: () => { redraws += 1; },
    drawSnapIndicator: () => { indicators += 1; },
  };
  paintHoverSnap(ctx, 1, 1);
  paintHoverSnap(ctx, 1, 1);
  assert.equal(redraws, 1);
  assert.equal(indicators, 1);
  ctx.snap = () => ({ x: 30, y: 20, snapped: true, type: 'endpoint' });
  paintHoverSnap(ctx, 2, 2);
  assert.equal(redraws, 2);
  ctx.snap = () => ({ x: 0, y: 0, snapped: false });
  paintHoverSnap(ctx, 3, 3);
  assert.equal(ctx.state.lastSnapResult, null);
  assert.equal(redraws, 3);
});

test('the point just placed is not a magnet and an earlier vertex still is', () => {
  rustigeSnap();
  const punten = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const opDeLaatste = performSnap(100, 2, [], 1, 1, null, punten);
  assert.equal(opDeLaatste.snapped, false, 'a click beside the last vertex stays on the cursor');
  assert.equal(opDeLaatste.x, 100);
  const opDeEerste = performSnap(2, 0, [], 1, 1, null, punten);
  assert.equal(opDeEerste.snapped, true);
  assert.equal(opDeEerste.x, 0);
  assert.equal(opDeEerste.y, 0);
  const alleen = performSnap(0, 1, [], 1, 1, null, [{ x: 0, y: 0 }]);
  assert.equal(alleen.snapped, false, 'the first vertex is not a magnet for the second click');
});
