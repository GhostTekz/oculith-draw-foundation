// Markup R-tree: a far markup stays out until its geometry moves, overlapping
// boxes both come back, and a raceway band is hittable beside its centreline.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { markupsNear, markupsNearIndices } = await import('./markup-rtree.js');
const { annotationBounds } = await import('./spatial-index.js');
const { bandWidthIn, normalizeRaceway, drawPxPerIn } = await import('./raceway.js');

test('a far line is absent until it moves next to the cursor', () => {
  const line = { type: 'line', page: 1, startX: 4000, startY: 4000, endX: 4200, endY: 4000 };
  const anns = [line];
  assert.equal(markupsNear(anns, 1, 10, 10, 12).has(line), false);
  line.startX = 0;
  line.startY = 10;
  line.endX = 40;
  line.endY = 10;
  assert.equal(markupsNear(anns, 1, 10, 10, 12).has(line), true);
});

test('a vertex drag and a splice show up on the next query', () => {
  const poly = {
    type: 'polyline', page: 1,
    points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
  };
  const anns = [poly];
  assert.equal(markupsNear(anns, 1, 500, 500, 8).has(poly), false);
  poly.points[1] = { x: 500, y: 500 };
  assert.equal(markupsNear(anns, 1, 500, 500, 8).has(poly), true);
  const extra = { type: 'line', page: 1, startX: 800, startY: 800, endX: 830, endY: 800 };
  anns.push(extra);
  assert.equal(markupsNear(anns, 1, 810, 800, 8).has(extra), true);
  assert.equal(markupsNear(anns, 1, 810, 800, 8).has(extra), true);
});

test('two overlapping boxes are both in the set', () => {
  const a = { type: 'box', page: 1, x: 0, y: 0, width: 40, height: 40 };
  const b = { type: 'box', page: 1, x: 15, y: 15, width: 40, height: 40 };
  const set = markupsNear([a, b], 1, 20, 20, 0);
  assert.equal(set.has(a), true);
  assert.equal(set.has(b), true);
  assert.equal(set.size, 2);
});

test('page reassignment and nested edits refresh only the queried page', () => {
  const moving = { type: 'polyline', page: 2, points: [{ x: 400, y: 400 }, { x: 420, y: 400 }] };
  const other = { type: 'box', page: 3, x: 0, y: 0, width: 20, height: 20 };
  const anns = [moving, other];
  assert.equal(markupsNear(anns, 1, 10, 10, 4).size, 0);
  moving.page = 1;
  moving.points[0].x = 10;
  moving.points[0].y = 10;
  assert.equal(markupsNear(anns, 1, 10, 10, 4).has(moving), true);
  assert.equal(markupsNear(anns, 2, 410, 400, 4).has(moving), false);
});

test('candidate slots preserve topmost paint order across pages', () => {
  const box = (page) => ({ type: 'box', page, x: 0, y: 0, width: 20, height: 20 });
  const anns = [box(1), box(2), box(1), box(1)];
  assert.deepEqual(markupsNearIndices(anns, 1, 10, 10, 0), [3, 2, 0]);
});

test('a raceway band wider than the centreline bounds is included beside the line', () => {
  const ann = {
    type: 'measurePerimeter',
    measureKind: 'raceway',
    page: 1,
    measurePxPerIn: 72,
    lineWidth: 1,
    raceway: { kind: 'tray', trayStyle: 'ladder', widthIn: 24 },
    points: [{ x: 0, y: 100 }, { x: 400, y: 100 }],
  };
  const centre = annotationBounds(ann, { goedkoop: true });
  const rw = normalizeRaceway(ann.raceway);
  const half = bandWidthIn(rw) * drawPxPerIn(rw, ann.measurePxPerIn) / 2;
  assert.ok(half > centre.height, 'the band is wider than the centreline box');
  const y = centre.y + centre.height + 1;
  assert.ok(y > centre.y + centre.height);
  assert.ok(y < 100 + half, `cursor y ${y} is still on the band (half ${half})`);
  assert.equal(markupsNear([ann], 1, 200, y, 0).has(ann), true);
  assert.equal(markupsNear([ann], 1, 200, 100 + half + 30, 0).has(ann), false);
});

test('point text above the baseline and past the stand-in box stays a candidate', () => {
  const text = {
    type: 'text', page: 1, x: 100, y: 200, fontSize: 16,
    text: 'ELECTRICAL ROOM',
  };
  assert.equal(markupsNear([text], 1, 110, 186, 0).has(text), true);
  assert.equal(markupsNear([text], 1, 100 + 14 * 16, 200, 0).has(text), true);
});
