import assert from 'node:assert/strict';
import test from 'node:test';
import { copiesForPages } from './copy-to-pages.js';

function ids() {
  let n = 0;
  return () => `id${++n}`;
}

test('two markups on page 2 copy onto 1 and 3 and skip their own page', () => {
  const sources = [
    { id: 'a', page: 2, type: 'line', x: 10, y: 20 },
    { id: 'b', page: 2, type: 'line', x: 30, y: 40 },
  ];
  const before = JSON.stringify(sources);
  const copies = copiesForPages(sources, [1, 2, 3], { makeId: ids() });
  assert.deepEqual(copies.map((copy) => copy.page), [1, 1, 3, 3]);
  assert.deepEqual(copies.map((copy) => copy.x), [10, 30, 10, 30]);
  assert.equal(JSON.stringify(sources), before);
  assert.equal(new Set(copies.map((copy) => copy.id)).size, 4);
  for (const copy of copies) assert.ok(copy.id !== 'a' && copy.id !== 'b');
});

test('a grouped pair gets a new group on each target page and the source group stays', () => {
  const sources = [
    { id: 'a', page: 2, type: 'line', x: 1, y: 1, groupId: 'g1' },
    { id: 'b', page: 2, type: 'line', x: 5, y: 5, groupId: 'g1' },
  ];
  const copies = copiesForPages(sources, [1, 3], { makeId: ids() });
  const on = (page) => copies.filter((copy) => copy.page === page);
  assert.equal(on(1).length, 2);
  assert.equal(on(3).length, 2);
  assert.equal(on(1)[0].groupId, on(1)[1].groupId);
  assert.equal(on(3)[0].groupId, on(3)[1].groupId);
  assert.notEqual(on(1)[0].groupId, on(3)[0].groupId);
  assert.notEqual(on(1)[0].groupId, 'g1');
  assert.equal(sources[0].groupId, 'g1');
  assert.equal(sources[1].groupId, 'g1');
  assert.ok(copies.every((copy) => copy.id !== 'a' && copy.id !== 'b'));
});

test('a markup is copied to other pages in the range and not to its own', () => {
  const sources = [
    { id: 'a', page: 1, type: 'box', x: 4, y: 8 },
    { id: 'b', page: 2, type: 'box', x: 6, y: 9 },
  ];
  const copies = copiesForPages(sources, [1, 2], { makeId: ids() });
  assert.deepEqual(copies.map((copy) => [copy.page, copy.x]), [[1, 6], [2, 4]]);
});
