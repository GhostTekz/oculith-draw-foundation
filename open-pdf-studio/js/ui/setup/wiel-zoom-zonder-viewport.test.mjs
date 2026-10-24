import assert from 'node:assert/strict';
import test from 'node:test';
import { makeWheelZoom, scaleAfterWheel, WHEEL_ZOOM_MIN, WHEEL_ZOOM_MAX } from './wiel-zoom-zonder-viewport.js';

function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = { fn, at: t + ms }; timers.push(id); return id; },
    clearTimer: (id) => { const i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      t += ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > t) break;
        const id = timers.shift();
        await id.fn();
      }
    },
  };
}

test('wheel zoom: up zooms in, down zooms out, clamped', () => {
  assert.ok(scaleAfterWheel(1.5, -100) > 1.5);
  assert.ok(scaleAfterWheel(1.5, 100) < 1.5);
  assert.equal(scaleAfterWheel(0.06, 10000), WHEEL_ZOOM_MIN);
  assert.equal(scaleAfterWheel(20, -10000), WHEEL_ZOOM_MAX);
});

test('a burst of notches is one re-render, with the combined scale and the last anchor', async () => {
  const c = fakeClock();
  let scale = 1.5;
  const applied = [];
  const onWheel = makeWheelZoom({ getScale: () => scale, apply: async (s, a) => { applied.push([s, a]); scale = s; }, ...c });
  for (let i = 0; i < 6; i++) { onWheel(-100, { clientX: i, clientY: 0 }); await c.advance(20); }
  assert.equal(applied.length, 0, 'still turning (within 120 ms of the last notch, under 300 ms)');
  await c.advance(200);
  assert.equal(applied.length, 1);
  assert.ok(Math.abs(applied[0][0] - 1.5 * Math.pow(1.0015, 600)) < 1e-9);
  assert.deepEqual(applied[0][1], { clientX: 5, clientY: 0 });
});

test('a long gesture still re-renders at least every 300 ms', async () => {
  const c = fakeClock();
  let scale = 1;
  const applied = [];
  const onWheel = makeWheelZoom({ getScale: () => scale, apply: async (s) => { applied.push(s); scale = s; }, ...c });
  for (let i = 0; i < 40; i++) { onWheel(-50); await c.advance(25); }
  await c.advance(500);
  assert.ok(applied.length >= 3, `applied ${applied.length} times over a 1 s gesture`);
  assert.ok(Math.abs(scale - Math.pow(1.0015, 2000)) < 1e-9, 'no notch lost');
});
