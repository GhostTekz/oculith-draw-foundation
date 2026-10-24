// What the single-page viewport paints while its bitmaps are invalidated or
// replaced (page-frame.js), and the wiring that keeps the drawing on screen
// in pdf-viewport.js, the orchestrator, the caches and the text-edit save.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  choosePageFrame, continuationApplies, frameKey, holdShownFrame, makeContinuation,
  releaseHeldFrame, viewportFrameKey,
} from './page-frame.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

function bitmap(width = 100, height = 80) {
  return { width, height, close() { this.width = 0; this.height = 0; } };
}

function vp(extra = {}) {
  return {
    active: true, filePath: '/a.pdf', pageNum: 2, rotation: 0, viewRotation: 0,
    pageW: 1191, pageH: 842, originX: 0, originY: 0, pageType: 'raster',
    currentBitmap: null, currentTile: null, currentTileMeta: null,
    heldBitmap: null, heldTile: null, heldTileMeta: null, heldFor: null,
    ...extra,
  };
}

const META = { regionXpt: 10, regionYpt: 20, regionWpt: 100, regionHpt: 80 };

test('the current bitmap and tile are drawn when they are open', () => {
  const v = vp({ currentBitmap: bitmap(), currentTile: bitmap(), currentTileMeta: META });
  const f = choosePageFrame(v);
  assert.equal(f.bitmap, v.currentBitmap);
  assert.equal(f.tile, v.currentTile);
  assert.equal(f.tileMeta, META);
  assert.equal(f.detachedBitmap || f.detachedTile || f.releaseHeld || f.usesHeld, false);
});

test('a closed current bitmap or tile is never drawn, and is reported for a refetch', () => {
  const b = bitmap();
  const t = bitmap();
  b.close();
  t.close();
  const f = choosePageFrame(vp({ currentBitmap: b, currentTile: t, currentTileMeta: META }));
  assert.equal(f.bitmap, null);
  assert.equal(f.tile, null);
  assert.equal(f.detachedBitmap, true);
  assert.equal(f.detachedTile, true);
});

test('an invalidation holds the shown frame until the new render lands', () => {
  const shown = bitmap();
  const tile = bitmap();
  const v = vp({ currentBitmap: shown, currentTile: tile, currentTileMeta: META });
  assert.equal(holdShownFrame(v), true);
  // What cancelBitmapRendersForFile does next.
  v.currentBitmap = null;
  v.currentTile = null;
  v.currentTileMeta = null;

  let f = choosePageFrame(v);
  assert.equal(f.bitmap, shown, 'the drawing stays instead of a white sheet');
  assert.equal(f.tile, tile);
  assert.equal(f.tileMeta, META);
  assert.equal(f.usesHeld, true);
  assert.equal(f.releaseHeld, false);

  // A second invalidation in a row keeps the same hold.
  assert.equal(holdShownFrame(v), true);
  assert.equal(choosePageFrame(v).bitmap, shown);

  // The re-render lands: the hold ends and the fresh bitmap is drawn.
  const fresh = bitmap();
  v.currentBitmap = fresh;
  f = choosePageFrame(v);
  assert.equal(f.bitmap, fresh);
  assert.equal(f.tile, null, 'the held tile showed the old content; a new tile is asked for');
  assert.equal(f.releaseHeld, true);
  releaseHeldFrame(v);
  assert.equal(v.heldBitmap, null);
  assert.equal(v.heldFor, null);
});

test('a held frame is never shown on another page, file or rotation, or on a vector page', () => {
  for (const change of [{ pageNum: 3 }, { filePath: '/b.pdf' }, { rotation: 90 }, { pageType: 'vector' }]) {
    const v = vp({ currentBitmap: bitmap() });
    holdShownFrame(v);
    v.currentBitmap = null;
    Object.assign(v, change);
    const f = choosePageFrame(v);
    assert.equal(f.bitmap, null, JSON.stringify(change));
    assert.equal(f.releaseHeld, true, JSON.stringify(change));
  }
});

test('nothing open to hold keeps an earlier hold of the same page, and nothing else', () => {
  const v = vp();
  assert.equal(holdShownFrame(v), false);
  const shown = bitmap();
  v.currentBitmap = shown;
  holdShownFrame(v);
  v.currentBitmap = null;
  assert.equal(holdShownFrame(v), true);
  assert.equal(v.heldBitmap, shown);
  shown.close();
  assert.equal(choosePageFrame(v).bitmap, null, 'a held bitmap that got closed anyway is skipped');
});

test('frame keys normalise rotation', () => {
  assert.equal(frameKey('/a.pdf', 1, -90), frameKey('/a.pdf', 1, 270));
  assert.equal(frameKey('/a.pdf', 1, 360), '/a.pdf|1|0');
  assert.equal(viewportFrameKey(vp()), '/a.pdf|2|0');
});

test('a text-edit save reload continues the view on the same page under the new path', () => {
  const v = vp();
  const c = makeContinuation(v, 1000, 15000);
  const next = { filePath: '/tmp/opds-edit-1.pdf', pageNum: 2, pageW: 1191, pageH: 842, originX: 0, originY: 0, rotation: 0, viewRotation: 0 };
  assert.equal(continuationApplies(c, v, next, 2000), true);

  assert.equal(continuationApplies(c, v, { ...next, pageNum: 3 }, 2000), false, 'another page');
  assert.equal(continuationApplies(c, v, { ...next, pageW: 842, pageH: 1191 }, 2000), false, 'another size');
  assert.equal(continuationApplies(c, v, { ...next, rotation: 90 }, 2000), false, 'another rotation');
  assert.equal(continuationApplies(c, v, { ...next, viewRotation: 180 }, 2000), false, 'another view rotation');
  assert.equal(continuationApplies(c, v, { ...next, filePath: '/a.pdf' }, 2000), false, 'same path is no reload');
  assert.equal(continuationApplies(c, v, next, 1000 + 15001), false, 'expired');
  assert.equal(continuationApplies(c, { ...v, filePath: '/other.pdf' }, next, 2000), false, 'the viewport moved on');
  assert.equal(makeContinuation({ ...v, active: false }, 0, 1), null);
});

test('pdf-viewport paints only the chosen frame and keeps its loop alive', () => {
  const src = bron('./pdf-viewport.js');
  const render = src.slice(src.indexOf('function _render()'), src.indexOf('// ─── Load Page'));
  assert.match(render, /const frame = choosePageFrame\(viewport\);/);
  assert.doesNotMatch(render, /drawImage\(viewport\.currentBitmap/);
  assert.doesNotMatch(render, /drawImage\(viewport\.currentTile/);
  assert.match(render, /releaseUnshownBitmaps\(\);\s*\}\s*$/);
  // A frame that throws must not stop requestAnimationFrame.
  assert.match(src, /function _renderVeilig\(\) \{\s*try \{\s*_render\(\);/);
  const tick = src.slice(src.indexOf('function _startLoop()'), src.indexOf('export function schermPaginaMaat'));
  assert.match(tick, /_renderVeilig\(\);/);
  assert.doesNotMatch(tick, /[^a-zA-Z]_render\(\);/);
});

test('an invalidation holds the frame before it drops the bitmap', () => {
  const src = bron('./bitmap-orchestrator.js');
  const body = src.slice(src.indexOf('export function cancelBitmapRendersForFile'));
  const holdAt = body.indexOf('holdShownPage(filePath)');
  const nullAt = body.indexOf('viewport.currentBitmap = null');
  assert.ok(holdAt > 0 && holdAt < nullAt);
});

test('every bitmap cache closes through closeBitmap()', () => {
  for (const file of ['./page-bitmap-cache.js', './tile-cache.js', './progressive-render.js']) {
    const src = bron(file);
    assert.match(src, /import \{ closeBitmap \} from '\.\/bitmap-lifetime\.js';/, file);
    assert.doesNotMatch(src, /\.close\s*(?:\?\.)?\s*\(|\.close &&/, `${file} closes a bitmap directly`);
  }
});

test('a text-edit save continues the view and always drops the continuation', () => {
  const src = bron('./saver.js');
  const at = src.indexOf('vervolg?.continueViewOnNextLoad()');
  const reload = src.indexOf('await reloadFromBytes(', at);
  const drop = src.indexOf('vervolg?.dropViewContinuation()', reload);
  assert.ok(at > 0 && reload > at && drop > reload);
  assert.match(src.slice(reload, drop + 40), /\} finally \{\s*vervolg\?\.dropViewContinuation\(\);/);
});
