// Snapping looks only at markups near the cursor (snap-engine.js
// markeringenNabij). Hundreds of far-away markups must not change any result:
// end points, intersections, edges and circle centres near the cursor snap
// exactly as they do with only the nearby markups present.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { DEFAULT_PREFERENCES } = await import('../core/constants.js');
const { performSnap } = await import('./snap-engine.js');

function prefs() {
  state.preferences = { ...DEFAULT_PREFERENCES, measureScale: null, snapToPdfContent: false,
    enableGridSnap: false, enableAngleSnap: false, snapToEdges: true, snapToIntersections: true,
    snapToCenters: true, snapToEndpoints: true, snapToMidpoints: true };
  state.documents = [];
  state.activeDocumentIndex = -1;
}

const nabij = [
  { id: 'h', type: 'line', page: 1, startX: 100, startY: 100, endX: 300, endY: 100 },
  { id: 'v', type: 'line', page: 1, startX: 200, startY: 0, endX: 200, endY: 250 },
  { id: 'c', type: 'circle', page: 1, x: 380, y: 60, width: 80, height: 80 },
  { id: 'b', type: 'box', page: 1, x: 120, y: 160, width: 60, height: 50 },
];
const ver = [];
for (let i = 0; i < 600; i++) {
  const x = 2000 + (i % 30) * 90, y = 2000 + Math.floor(i / 30) * 90;
  ver.push(i % 3 === 0
    ? { id: `f${i}`, type: 'line', page: 1, startX: x, startY: y, endX: x + 60, endY: y + 40 }
    : i % 3 === 1
      ? { id: `f${i}`, type: 'box', page: 1, x, y, width: 50, height: 30 }
      : { id: `f${i}`, type: 'circle', page: 1, x, y, width: 40, height: 40 });
}
// Markups on another page at the very same spot must never snap.
const anderBlad = nabij.map((a) => ({ ...a, id: `p2${a.id}`, page: 2, startX: (a.startX ?? 0) + 1 }));

const cursors = [
  [203, 104],   // intersection of h and v
  [298, 97],    // end point of h
  [250, 103],   // on h (edge / nearest)
  [421, 99],    // circle centre
  [181, 158],   // box corner
  [150, 185],   // inside the box, away from edges
  [1000, 1000], // nothing near
];

test('far-away markups and other pages do not change any snap near the cursor', () => {
  prefs();
  for (const [x, y] of cursors) {
    const alleen = performSnap(x, y, nabij, 1, 1, null, null);
    const metVer = performSnap(x, y, [...ver, ...nabij, ...anderBlad, ...ver.slice(0, 50)], 1, 1, null, null);
    assert.deepEqual(
      { x: metVer.x, y: metVer.y, type: metVer.type, snapped: !!metVer.snapped },
      { x: alleen.x, y: alleen.y, type: alleen.type, snapped: !!alleen.snapped },
      `cursor ${x},${y}`,
    );
  }
});

test('the intersection near the cursor still wins with many markups present', () => {
  prefs();
  const r = performSnap(203, 104, [...ver, ...nabij], 1, 1, null, null);
  assert.equal(r.snapped, true);
  assert.equal(r.x, 200);
  assert.equal(r.y, 100);
});

test('a far-away markup is still a snap target when the cursor is near it', () => {
  prefs();
  const doel = ver[0]; // line from (2000,2000) to (2060,2040)
  const r = performSnap(2001, 2002, [...ver, ...nabij], 1, 1, null, null);
  assert.equal(r.snapped, true);
  assert.equal(r.x, doel.startX);
  assert.equal(r.y, doel.startY);
});

test('a broken area hole does not throw away a nearby endpoint snap', () => {
  prefs();
  const line = { id: 'h', type: 'line', page: 1, startX: 100, startY: 100, endX: 200, endY: 100 };
  const area = {
    id: 'bad', type: 'measureArea', page: 1,
    points: [{ x: 90, y: 90 }, { x: 140, y: 90 }, { x: 140, y: 130 }],
    holes: [[undefined, { x: 100, y: 100 }, { x: 110, y: 110 }]],
  };
  const r = performSnap(102, 101, [area, line], 1, 1, null, null);
  assert.equal(r.snapped, true);
  assert.equal(r.x, 100);
  assert.equal(r.y, 100);
});
