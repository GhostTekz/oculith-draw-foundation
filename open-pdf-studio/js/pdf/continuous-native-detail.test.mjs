import assert from 'node:assert/strict';
import test from 'node:test';
import { detailTileCovers, detailTileRequest } from './continuous-native-detail.js';

test('continuous detail covers a high-zoom viewport without a giant page bitmap', () => {
  const tile = detailTileRequest({
    page: { w: 9600, h: 7200 }, view: { x: 3800, y: 2200, w: 1600, h: 900 },
    scale: 4, dpr: 2,
  });
  assert.ok(tile);
  assert.ok(tile.css.w * 2 <= 4096);
  assert.ok(tile.css.h * 2 <= 4096);
  assert.equal(tile.renderScale, 8);
  assert.ok(detailTileCovers(tile.css, { x: 3800, y: 2200, w: 1600, h: 900 }));
  assert.equal(tile.points.x * 4, tile.css.x);
});

test('continuous detail clamps near page edges and asks for a new tile after a long pan', () => {
  const tile = detailTileRequest({
    page: { w: 5000, h: 5000 }, view: { x: 0, y: 4250, w: 1000, h: 750 },
    scale: 2, dpr: 1.5,
  });
  assert.equal(tile.css.x, 0);
  assert.equal(tile.css.y + tile.css.h, 5000);
  assert.ok(detailTileCovers(tile.css, { x: 0, y: 4250, w: 1000, h: 750 }));
  assert.equal(detailTileCovers(tile.css, { x: 2400, y: 4250, w: 1000, h: 750 }), false);
  assert.equal(detailTileRequest({ page: { w: 0, h: 1 }, view: { x: 0, y: 0, w: 1, h: 1 }, scale: 2, dpr: 1 }), null);
});
