// Freehand pen (pen-punten.js): every position since the previous frame joins
// the stroke, in order, except points under half a screen pixel from the
// previous one; the frame's own position is always kept.

import assert from 'node:assert/strict';
import test from 'node:test';
import { voegPenPuntenToe } from './pen-punten.js';

test('all positions of the frame join the stroke, in order', () => {
  const pad = [{ x: 0, y: 0 }];
  const vanaf = voegPenPuntenToe(pad, [{ x: 2, y: 1 }, { x: 5, y: 2 }, { x: 8, y: 1 }], { x: 10, y: 0 }, 2);
  assert.equal(vanaf, 0);
  assert.deepEqual(pad, [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 5, y: 2 }, { x: 8, y: 1 }, { x: 10, y: 0 }]);
});

test('points under half a screen pixel from the previous one are skipped', () => {
  // scale 2: half a screen pixel = 0.25 page units.
  const pad = [{ x: 0, y: 0 }];
  voegPenPuntenToe(pad, [{ x: 0.1, y: 0 }, { x: 0.2, y: 0.1 }, { x: 1, y: 0 }, { x: 1.1, y: 0 }], { x: 3, y: 0 }, 2);
  assert.deepEqual(pad, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }]);
});

test("the frame's own position is kept even when it is very close", () => {
  const pad = [{ x: 0, y: 0 }];
  voegPenPuntenToe(pad, [], { x: 0.01, y: 0 }, 2);
  assert.deepEqual(pad, [{ x: 0, y: 0 }, { x: 0.01, y: 0 }]);
});

test('without in-between points it behaves as before', () => {
  const pad = [{ x: 0, y: 0 }];
  assert.equal(voegPenPuntenToe(pad, undefined, { x: 4, y: 4 }, 1.5), 0);
  assert.deepEqual(pad, [{ x: 0, y: 0 }, { x: 4, y: 4 }]);
});
