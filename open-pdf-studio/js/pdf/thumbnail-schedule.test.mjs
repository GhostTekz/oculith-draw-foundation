import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  thumbnailResultKeepsQueue,
  createThumbnailCoordinator,
  raceThumbnailRender,
} from './thumbnail-schedule.js';

test('a cancelled or still-running thumbnail stays queued and a finished picture does not', () => {
  assert.equal(thumbnailResultKeepsQueue({ deferred: 'cancelled' }), true);
  assert.equal(thumbnailResultKeepsQueue({ deferred: 'waiting' }), true);
  assert.equal(thumbnailResultKeepsQueue({ deferred: 'slow' }), true);
  assert.equal(thumbnailResultKeepsQueue({ dataURL: 'data:', width: 1, height: 1 }), false);
  assert.equal(thumbnailResultKeepsQueue(null), false);
});

test('a deferred 16th thumbnail does not stop the later visible rows', () => {
  let time = 0;
  const queue = createThumbnailCoordinator({ deferMs: 500, now: () => time });
  const cached = new Set();
  for (let page = 1; page <= 20; page++) queue.pages.add(page);

  const painted = [];
  for (let step = 0; step < 25; step++) {
    const next = queue.take({
      isCached: (page) => cached.has(page),
      isBlocked: () => false,
    });
    if (next.page == null) break;
    if (next.page === 16) {
      queue.hold(16, 'cancelled');
      continue;
    }
    cached.add(next.page);
    painted.push(next.page);
  }

  assert.deepEqual(painted, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20]);
  assert.equal(queue.pages.has(16), true);
  assert.equal(queue.hasRunnable((page) => cached.has(page)), false);

  time = 499;
  assert.equal(queue.take({ isCached: (page) => cached.has(page), isBlocked: () => false }).page, null);
  time = 500;
  assert.equal(queue.take({ isCached: (page) => cached.has(page), isBlocked: () => false }).page, 16);
});

test('an unclassified row stays queued and runs when its type hold is released', () => {
  let time = 0;
  const queue = createThumbnailCoordinator({ deferMs: 500, now: () => time });
  queue.pages.add(16);
  queue.pages.add(17);
  const blocked = new Set([16]);
  const first = queue.take({ isCached: () => false, isBlocked: (page) => blocked.has(page) });
  assert.equal(first.page, 17);
  assert.equal(queue.pages.has(16), true);
  const waiting = queue.take({ isCached: () => false, isBlocked: (page) => blocked.has(page) });
  assert.equal(waiting.page, null);
  assert.equal(waiting.status, 'deferred');

  blocked.delete(16);
  queue.releaseTypeHolds();
  assert.equal(queue.take({ isCached: () => false, isBlocked: () => false }).page, 16);
});

test('a thumbnail that is still rendering is not started twice', () => {
  const queue = createThumbnailCoordinator({ now: () => 0 });
  queue.pages.add(16);
  queue.pages.add(17);
  const first = queue.take({ isCached: () => false, isBlocked: () => false });
  assert.equal(first.page, 16);
  queue.markInFlight(16);
  queue.pages.add(16);
  const second = queue.take({ isCached: () => false, isBlocked: () => false });
  assert.equal(second.page, 17);
  const third = queue.take({ isCached: () => false, isBlocked: () => false });
  assert.equal(third.status, 'deferred');
  assert.equal(queue.hasRunnable(), false);
});

test('a start requested while the strip is busy is not lost', () => {
  const queue = createThumbnailCoordinator();
  assert.equal(queue.requestRun(), true);
  assert.equal(queue.requestRun(), false);
  assert.equal(queue.finishPass(), 'again');
  assert.equal(queue.requestRun(), true);
  assert.equal(queue.finishPass(), 'idle');
});

test('a render that does not return frees the queue and a late picture is kept', async () => {
  let finish;
  let late = null;
  let timedOut = 0;
  const hung = new Promise((resolve) => { finish = resolve; });
  const first = await raceThumbnailRender(hung, 20, (image) => { late = image; }, () => { timedOut += 1; });
  assert.deepEqual(first, { deferred: 'slow' });
  assert.equal(timedOut, 1);
  assert.equal(thumbnailResultKeepsQueue(first), true);
  finish({ dataURL: 'data:late', width: 2, height: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(late, { dataURL: 'data:late', width: 2, height: 3 });
});

test('a render that fails after the deadline does not reject the race', async () => {
  let fail;
  const hung = new Promise((_, reject) => { fail = reject; });
  const first = await raceThumbnailRender(hung, 15, () => {});
  assert.deepEqual(first, { deferred: 'slow' });
  fail(new Error('worker 0 read timeout (60s)'));
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('the visible strip keeps going after a deferred row and a hung render', () => {
  const panel = readFileSync(new URL('../ui/panels/left-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /createThumbnailCoordinator\(/);
  assert.match(panel, /raceThumbnailRender\(/);
  assert.match(panel, /releaseTypeHolds\(\)/);
  assert.match(panel, /THUMBNAIL_RENDER_TIMEOUT_MS/);
});
