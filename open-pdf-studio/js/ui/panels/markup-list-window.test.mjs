import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MARKUP_LIST_WINDOW_AT,
  markupListSlice,
  nextArrowMarkup,
  rowHeight,
  scrollTopToReveal,
  windowForScroll,
} from './markup-list-window.js';

test('row heights follow the list grid', () => {
  assert.equal(rowHeight({ isHeader: true }), 24);
  assert.equal(rowHeight({ id: 'a' }), 24);
  assert.equal(rowHeight({ isMarkupGroup: true }), 24);
  assert.equal(rowHeight({ isReply: true }), 28);
  assert.equal(rowHeight({ isReply: true, isReplyInput: true }), 40);
});

test('a short list stays fully mounted', () => {
  const shown = Array.from({ length: MARKUP_LIST_WINDOW_AT }, (_, i) => ({ id: `m${i}` }));
  const slice = markupListSlice(shown, { scrollTop: 400, viewportHeight: 200 });
  assert.equal(slice.virtual, false);
  assert.equal(slice.padTop, 0);
  assert.equal(slice.padBottom, 0);
  assert.equal(slice.end, MARKUP_LIST_WINDOW_AT);
});

test('a long list mounts the visible window and pads the rest', () => {
  const heights = Array.from({ length: 100 }, () => 24);
  const win = windowForScroll({ heights, scrollTop: 0, viewportHeight: 240, overscan: 8 });
  assert.equal(win.start, 0);
  assert.equal(win.end, 17);
  assert.equal(win.padTop, 0);
  assert.equal(win.padBottom, 1992);
  assert.equal(win.padTop + (win.end - win.start) * 24 + win.padBottom, win.total);

  const scrolled = windowForScroll({ heights, scrollTop: 480, viewportHeight: 240, overscan: 8 });
  assert.ok(scrolled.start > 0);
  assert.ok(scrolled.end < 100);
  assert.ok(scrolled.padTop > 0);
  assert.ok(scrolled.padBottom > 0);
  assert.equal(scrolled.padTop + (scrolled.end - scrolled.start) * 24 + scrolled.padBottom, scrolled.total);

  const slice = markupListSlice(heights.map((_, i) => ({ id: `m${i}` })), {
    scrollTop: 480,
    viewportHeight: 240,
  });
  assert.equal(slice.virtual, true);
  assert.equal(slice.start, scrolled.start);
});

test('scroll-into-view leaves a row that is already on screen', () => {
  const offsets = windowForScroll({
    heights: Array.from({ length: 10 }, () => 24),
    scrollTop: 0,
    viewportHeight: 120,
  }).offsets;
  assert.equal(scrollTopToReveal(offsets, 0, 0, 120), 0);
  assert.equal(scrollTopToReveal(offsets, 2, 0, 80), 0);
  assert.ok(scrollTopToReveal(offsets, 8, 0, 120) > 0);
  const above = scrollTopToReveal(offsets, 0, 200, 120);
  assert.ok(above < 200);
});

test('arrow keys walk shown markups and stop at a group row', () => {
  const shown = [
    { isHeader: true, groupKey: 'p1' },
    { id: 'a' },
    { isMarkupGroup: true, mgId: 'g1' },
    { id: 'b' },
    { isReply: true, parentId: 'b' },
    { id: 'c' },
  ];
  assert.equal(nextArrowMarkup(shown, 'a', 1), null);
  assert.equal(nextArrowMarkup(shown, 'b', 1)?.item.id, 'c');
  assert.equal(nextArrowMarkup(shown, 'c', -1)?.item.id, 'b');
  assert.equal(nextArrowMarkup(shown, 'b', -1), null);
});
