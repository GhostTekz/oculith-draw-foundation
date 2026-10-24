import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjacentConfirmedPair, confirmPagePair, currentConfirmedPair } from './page-pairs.js';

test('a manually confirmed pair has provenance and can be revisited in page order', () => {
  let pairs = confirmPagePair([], 5, 8, '2026-10-13T19:00:00.000Z');
  pairs = confirmPagePair(pairs, 2, 3, '2026-10-13T19:01:00.000Z');
  assert.deepEqual(pairs.map(pair => [pair.oldPage, pair.newPage]), [[2, 3], [5, 8]]);
  assert.equal(currentConfirmedPair(pairs, 5, 8).source, 'manual');
  assert.equal(currentConfirmedPair(pairs, 5, 8).confirmedAt, '2026-10-13T19:00:00.000Z');
  assert.deepEqual(adjacentConfirmedPair(pairs, 2, 3, 1), pairs[1]);
  assert.deepEqual(adjacentConfirmedPair(pairs, 5, 8, -1), pairs[0]);
  assert.equal(adjacentConfirmedPair(pairs, 5, 7, 1), null);
});

test('remapping a page replaces both conflicting associations', () => {
  let pairs = confirmPagePair([], 2, 4, 'earlier');
  pairs = confirmPagePair(pairs, 3, 5, 'earlier');
  pairs = confirmPagePair(pairs, 2, 5, 'later');
  assert.deepEqual(pairs, [{ oldPage: 2, newPage: 5, source: 'manual', confirmedAt: 'later' }]);
  assert.equal(currentConfirmedPair(pairs, 2, 4), null);
});

test('invalid pages cannot enter the match list', () => {
  assert.throws(() => confirmPagePair([], 0, 3), /positive whole/);
  assert.throws(() => confirmPagePair([], 2.5, 3), /positive whole/);
});
