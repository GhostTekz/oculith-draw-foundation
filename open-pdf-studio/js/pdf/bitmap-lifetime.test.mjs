// A cache must not close the ImageBitmap the viewport is painting. Before
// this guard a FIFO eviction, a tile prewarm or an invalidation (save, native
// layer change, an edited /AP markup) closed it, drawImage() threw
// InvalidStateError after the page had been filled white, and the rAF loop
// died: the drawing stayed white.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();

const {
  closeBitmap, isUsableBitmap, parkedBitmapCount, releaseUnshownBitmaps,
} = await import('./bitmap-lifetime.js');
const { BITMAP_BUDGET_BYTES } = await import('./bitmap-budget.js');
const pageCache = await import('./page-bitmap-cache.js');
const tileCache = await import('./tile-cache.js');

function fakeBitmap(width = 40, height = 30) {
  return {
    width,
    height,
    closed: false,
    close() {
      this.closed = true;
      this.width = 0;
      this.height = 0;
    },
  };
}

function freshViewport() {
  globalThis.__pdfViewport = { currentBitmap: null, currentTile: null, heldBitmap: null, heldTile: null };
  return globalThis.__pdfViewport;
}

test('an unshown bitmap closes at once; a shown one waits until the viewport lets go', () => {
  const vp = freshViewport();
  const spare = fakeBitmap();
  closeBitmap(spare);
  assert.equal(spare.closed, true);

  for (const slot of ['currentBitmap', 'currentTile', 'heldBitmap', 'heldTile']) {
    const shown = fakeBitmap();
    vp[slot] = shown;
    closeBitmap(shown);
    assert.equal(shown.closed, false, `${slot} stays drawable`);
    assert.equal(isUsableBitmap(shown), true);
    assert.equal(releaseUnshownBitmaps(), 0, `${slot} still shown`);
    vp[slot] = null;
    assert.equal(releaseUnshownBitmaps(), 1);
    assert.equal(shown.closed, true, `${slot} closes once replaced`);
  }
  assert.equal(parkedBitmapCount(), 0);
});

test('a closed ImageBitmap is not usable (it reports 0x0)', () => {
  const b = fakeBitmap();
  assert.equal(isUsableBitmap(b), true);
  b.close();
  assert.equal(isUsableBitmap(b), false);
  assert.equal(isUsableBitmap(null), false);
});

test('invalidating a document keeps the page bitmap on screen open', () => {
  const vp = freshViewport();
  const path = '/tmp/lifetime-invalidate.pdf';
  const shown = fakeBitmap();
  const other = fakeBitmap();
  assert.equal(pageCache.setCachedBitmapEntry(path, 1, 0, 1, shown, 40, 30, 1), true);
  assert.equal(pageCache.setCachedBitmapEntry(path, 1, 0, 2, other, 40, 30, 2), true);
  vp.currentBitmap = shown;

  pageCache.invalidateDocumentBitmaps(path);
  assert.equal(other.closed, true, 'the rest of the cache is freed');
  assert.equal(shown.closed, false, 'the bitmap on screen survives the invalidation');
  assert.equal(pageCache.getCachedBitmap(path, 1, 0, 1), null, 'but it is no longer cached');

  vp.currentBitmap = null;
  releaseUnshownBitmaps();
  assert.equal(shown.closed, true);
});

test('the page cache evicts the least recently used bitmap, and never closes the shown one', () => {
  const vp = freshViewport();
  const path = '/tmp/lifetime-lru.pdf';
  const buckets = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
  const bitmaps = buckets.map(() => fakeBitmap());
  buckets.forEach((b, i) => pageCache.setCachedBitmapEntry(path, 3, 0, b, bitmaps[i], 40, 30, b));

  // The first bitmap is the one on screen and was just looked up.
  assert.equal(pageCache.getCachedBitmap(path, 3, 0, buckets[0]).bitmap, bitmaps[0]);
  vp.currentBitmap = bitmaps[0];

  const next = fakeBitmap();
  pageCache.setCachedBitmapEntry(path, 3, 0, 512, next, 40, 30, 512);
  assert.equal(bitmaps[1].closed, true, 'the least recently used entry goes');
  assert.equal(bitmaps[0].closed, false, 'the shown, recently used bitmap stays');
  assert.ok(pageCache.getCachedBitmap(path, 3, 0, buckets[0]));

  // Even when the shown bitmap is the oldest entry, it is parked, not closed.
  const path2 = '/tmp/lifetime-fifo.pdf';
  const oldest = fakeBitmap();
  pageCache.setCachedBitmapEntry(path2, 1, 0, 1, oldest, 40, 30, 1);
  vp.currentBitmap = oldest;
  for (let i = 0; i < 14; i++) pageCache.setCachedBitmapEntry(path2, 2, 0, 2 ** i, fakeBitmap(), 40, 30, 1);
  assert.equal(pageCache.getCachedBitmap(path2, 1, 0, 1), null, 'evicted from the cache');
  assert.equal(oldest.closed, false, 'but still drawable');

  vp.currentBitmap = null;
  releaseUnshownBitmaps();
  assert.equal(oldest.closed, true);
  pageCache.clearAllBitmaps();
});

test('page bitmap cache respects a byte budget before its entry limit', () => {
  freshViewport();
  const path = '/tmp/lifetime-byte-budget.pdf';
  // One decoded RGBA page fits; two exceed the shared byte budget.
  const side = Math.floor(Math.sqrt(BITMAP_BUDGET_BYTES / 8)) + 1;
  const first = fakeBitmap(side, side);
  const second = fakeBitmap(side, side);
  pageCache.setCachedBitmapEntry(path, 1, 0, 1, first, side, side, 1);
  pageCache.setCachedBitmapEntry(path, 2, 0, 1, second, side, side, 1);
  assert.equal(pageCache.getCachedBitmap(path, 1, 0, 1), null);
  assert.equal(first.closed, true);
  assert.equal(pageCache.getCachedBitmap(path, 2, 0, 1).bitmap, second);
  pageCache.invalidateDocumentBitmaps(path);
});

test('clearing a file from the tile cache keeps the tile on screen open', async () => {
  const vp = freshViewport();
  const made = [];
  globalThis.createImageBitmap = async (img) => {
    const b = fakeBitmap(img.width, img.height);
    made.push(b);
    return b;
  };
  const path = '/tmp/lifetime-tiles.pdf';
  const image = { width: 64, height: 48 };
  const meta = { regionXpt: 0, regionYpt: 0, regionWpt: 64, regionHpt: 48 };
  await tileCache.tileCacheSet(path, 1, 2, 0, '0,0', image, meta);
  await tileCache.tileCacheSet(path, 1, 2, 0, '64,0', image, meta);
  const shown = tileCache.tileCacheGet(path, 1, 2, 0, '0,0').bitmap;
  vp.currentTile = shown;

  tileCache.tileCacheClearForFile(path);
  assert.equal(made.filter((b) => b !== shown).every((b) => b.closed), true);
  assert.equal(shown.closed, false);

  vp.currentTile = null;
  releaseUnshownBitmaps();
  assert.equal(shown.closed, true);
});
