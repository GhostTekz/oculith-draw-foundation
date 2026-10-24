import test from 'node:test';
import assert from 'node:assert/strict';
import { continuousPagesToRelease } from './continuous-residency.js';

test('keeps visible and focused pages while evicting distant surfaces', () => {
  const pages = [
    { pageNum: 1, inRange: false, focused: false, distance: 5000, bytes: 20 },
    { pageNum: 2, inRange: false, focused: false, distance: 600, bytes: 20 },
    { pageNum: 3, inRange: true, focused: false, distance: 0, bytes: 20 },
    { pageNum: 4, inRange: false, focused: true, distance: 5000, bytes: 20 },
  ];
  assert.deepEqual(continuousPagesToRelease(pages, { maxPages: 3, maxBytes: 100, retainDistance: 1000 }), [1]);
});

test('caps retained nonvisible surfaces by bytes and page count', () => {
  const pages = [
    { pageNum: 1, inRange: true, focused: false, distance: 0, bytes: 40 },
    { pageNum: 2, inRange: false, focused: false, distance: 10, bytes: 40 },
    { pageNum: 3, inRange: false, focused: false, distance: 20, bytes: 40 },
    { pageNum: 4, inRange: false, focused: false, distance: 30, bytes: 10 },
  ];
  assert.deepEqual(continuousPagesToRelease(pages, { maxPages: 3, maxBytes: 90, retainDistance: 100 }), [3]);
  assert.deepEqual(continuousPagesToRelease(pages, { maxPages: 2, maxBytes: 200, retainDistance: 100 }), [3, 4]);
});
