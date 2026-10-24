import assert from 'node:assert/strict';
import test from 'node:test';
import { thumbnailRowHeights, thumbnailWindow } from './thumbnail-window.js';

test('a long strip mounts only rows near the viewport while preserving scroll offsets', () => {
  const heights = thumbnailRowHeights(536, 140, (page) =>
    page === 250 ? { width: 140, height: 280 } : null,
  { width: 140, height: 100 });
  const full = thumbnailWindow(heights, 0, 600);
  const middle = thumbnailWindow(heights, full.offsets[249], 600);
  assert.ok(full.end - full.start < 20);
  assert.ok(middle.end - middle.start < 20);
  assert.ok(middle.start <= 249 && middle.end > 249);
  assert.equal(middle.top + heights.slice(middle.start, middle.end).reduce((a, b) => a + b, 0) + middle.bottom,
    heights.reduce((a, b) => a + b, 0));
  assert.ok(heights[249] > heights[248]);
});

test('empty and end-of-list viewports stay within the page range', () => {
  assert.deepEqual(thumbnailWindow([], 100, 600).start, 0);
  const end = thumbnailWindow([100, 200, 300], 10_000, 600);
  assert.equal(end.end, 3);
  assert.ok(end.start >= 0);
});

test('a narrow thumbnail does not reserve the full sidebar width as empty scroll space', () => {
  const heights = thumbnailRowHeights(536, 300,
    () => ({ width: 140, height: 280 }),
    { width: 140, height: 280 });
  const viewport = 368;
  // An image that is 280px high must fit in a 368px viewport with its row
  // chrome. Otherwise the user can scroll through a blank area between images.
  assert.ok(heights.every(height => height < viewport));
  const middle = thumbnailWindow(heights, heights[0] * 250, viewport);
  assert.ok(middle.end - middle.start >= 2);
});
