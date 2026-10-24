import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePageRange } from './page-range.js';

test('page ranges: singles and ascending ranges, sorted and deduplicated', () => {
  assert.deepEqual(parsePageRange('1-3,5', 6), { pages: [1, 2, 3, 5] });
  assert.deepEqual(parsePageRange(' 2, 4 - 6 ,4', 6), { pages: [2, 4, 5, 6] });
  assert.deepEqual(parsePageRange('7', 7), { pages: [7] });
  assert.deepEqual(parsePageRange('3-3', 3), { pages: [3] });
});

test('invalid page ranges name the error', () => {
  assert.deepEqual(parsePageRange('', 5), { error: 'empty' });
  assert.deepEqual(parsePageRange('   ', 5), { error: 'empty' });
  assert.deepEqual(parsePageRange('1-3,8', 5), { error: 'outOfRange', part: '8' });
  assert.deepEqual(parsePageRange('4-9', 5), { error: 'outOfRange', part: '4-9' });
  assert.deepEqual(parsePageRange('3-1', 5), { error: 'syntax', part: '3-1' });
  assert.deepEqual(parsePageRange('0', 5), { error: 'syntax', part: '0' });
  assert.deepEqual(parsePageRange('1,,2', 5), { error: 'syntax', part: '' });
  assert.deepEqual(parsePageRange('a-b', 5), { error: 'syntax', part: 'a-b' });
  assert.deepEqual(parsePageRange('-2', 5), { error: 'syntax', part: '-2' });
  assert.deepEqual(parsePageRange('1.5', 5), { error: 'syntax', part: '1.5' });
});
