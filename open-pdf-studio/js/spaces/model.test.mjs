// Spaces model: rooms and stored spaces in one nested list, the Space of a
// markup (deepest space at its anchor), edits and the Quantities helpers.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectSpaces, markupSpacePather, markupAnchor, spaceTree, spacePathText, withSpaceAdded,
  withSpaceChanged, withSpaceRemoved, outlineOfMarkup, spacesOnPages, nextSpaceName, takeOverSpaces,
  normalizeSpace, withSpacePaths, elementsInSpace, spacePathWithin, markupsInSpace, SPACE_PATH_SEPARATOR,
} from './model.js';
import { buildSchedule } from '../quantities/engine.js';

import { fixture, rect } from './spaces-fixture.testhulp.mjs';

const EXPECTED = {
  m1: 'Kitchen', m2: 'Living', m3: `Office${SPACE_PATH_SEPARATOR}Closet`, m4: 'Office', m5: 'Living',
  m6: '', m7: 'Kitchen', m8: `Office${SPACE_PATH_SEPARATOR}Closet`, m9: 'Office', m10: '',
};

test('rooms and stored spaces are one nested list; the closet nests in the office by geometry', () => {
  const doc = fixture();
  const spaces = collectSpaces(doc);
  assert.deepEqual(spaces.map(s => [s.id, s.source, s.parent, s.depth]), [
    ['office', 'space', null, 0],
    ['closet', 'space', 'office', 1],
    ['room:kitchen', 'room', null, 0],
    ['room:living', 'room', null, 0],
  ]);
  // Parents come before their children, siblings by name.
  assert.deepEqual(spaceTree(spaces).map(r => `${'  '.repeat(r.level)}${r.space.name}`),
    ['Kitchen', 'Living', 'Office', '  Closet']);
  assert.equal(spacePathText(spaces[1]), 'Office ▸ Closet');
});

test('10 markups get the deepest containing space as their Space; moving one updates it', () => {
  const doc = fixture();
  const spaceOf = markupSpacePather(doc);
  const got = Object.fromEntries(doc.annotations.filter(a => a.id.startsWith('m')).map(a => [a.id, spaceOf(a)]));
  assert.deepEqual(got, EXPECTED);
  // A room is in its own space.
  assert.equal(spaceOf(doc.annotations[0]), 'Kitchen');
  // Move m1 (Kitchen) into the closet; the next resolver sees it there.
  const m1 = doc.annotations.find(a => a.id === 'm1');
  m1.x = 360; m1.y = 560;
  assert.equal(markupSpacePather(doc)(m1), 'Office ▸ Closet');
  m1.x = 720; m1.y = 40;
  assert.equal(markupSpacePather(doc)(m1), 'Living');
  // Moving a room moves its space: the living room shifts away from m5.
  const living = doc.annotations.find(a => a.id === 'living');
  living.points = living.points.map(p => ({ x: p.x, y: p.y + 1000 }));
  assert.equal(markupSpacePather(doc)(doc.annotations.find(a => a.id === 'm5')), '');
});

test('anchors: a region by its label point, a line by its middle, a box by its centre', () => {
  assert.deepEqual(markupAnchor({ type: 'line', startX: 0, startY: 0, endX: 10, endY: 20 }), { x: 5, y: 10 });
  assert.deepEqual(markupAnchor({ type: 'box', x: 10, y: 10, width: 10, height: 20 }), { x: 15, y: 20 });
  // L-shaped area: the centroid falls outside, the label point is inside.
  const l = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 100 }, { x: 0, y: 100 }];
  const p = markupAnchor({ type: 'measureArea', points: l });
  assert.ok(p.x <= 10 || p.y <= 10, JSON.stringify(p));
  assert.equal(markupAnchor({ type: 'odd' }, () => ({ x: 1, y: 1, width: 2, height: 2 })).x, 2);
});

test('explicit parent wins over geometry; loops and stale parents fall back', () => {
  const doc = fixture();
  doc.spaces.push({ id: 'desk', page: 1, name: 'Desk', parentId: 'room:kitchen', points: rect(20, 320, 60, 360) });
  let s = collectSpaces(doc).find(x => x.id === 'desk');
  assert.deepEqual(s.path, ['Kitchen', 'Desk'], 'named parent');
  doc.spaces.find(x => x.id === 'desk').parentId = 'ghost';
  s = collectSpaces(doc).find(x => x.id === 'desk');
  assert.deepEqual(s.path, ['Office', 'Desk'], 'unknown parent: by geometry');
  // office → closet → office would loop.
  doc.spaces.find(x => x.id === 'office').parentId = 'closet';
  const all = collectSpaces(doc);
  for (const x of all) assert.ok(x.path.length <= 3, x.path.join('/'));
  assert.equal(new Set(all.map(x => x.id)).size, all.length);
});

test('edits: add (auto id, colour, name), change, remove re-parents the children', () => {
  let list = withSpaceAdded([], { page: 1, points: rect(0, 0, 10, 10), name: 'A' });
  assert.equal(list.length, 1);
  assert.match(list[0].id, /^sp-/);
  assert.match(list[0].color, /^#[0-9a-f]{6}$/);
  list = withSpaceAdded(list, { page: 1, points: rect(1, 1, 5, 5), name: 'B', parentId: list[0].id });
  assert.equal(withSpaceAdded(list, { page: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }).length, 2, 'no outline: no space');
  const changed = withSpaceChanged(list, list[1].id, { name: '  Bee \n', color: '#ABCDEF', page: 9 });
  assert.equal(changed[1].name, 'Bee');
  assert.equal(changed[1].color, '#abcdef');
  assert.equal(changed[1].page, 1, 'the page of a space does not change by an edit');
  const removed = withSpaceRemoved(changed, list[0].id);
  assert.deepEqual(removed.map(s => [s.name, s.parentId]), [['Bee', null]]);
  assert.equal(nextSpaceName([{ page: 1, name: 'Space 1' }, { page: 2, name: 'Space 2' }], 1), 'Space 2');
  assert.equal(normalizeSpace({ id: 'room:x', page: 1, points: rect(0, 0, 1, 1) }), null, 'room ids are reserved');
});

test('outline of an area measurement, polygon, box and ellipse; not of a line', () => {
  assert.equal(outlineOfMarkup({ type: 'measureArea', points: rect(0, 0, 5, 5) }).length, 4);
  assert.deepEqual(outlineOfMarkup({ type: 'box', x: 1, y: 2, width: 3, height: 4 }), rect(1, 2, 4, 6));
  assert.equal(outlineOfMarkup({ type: 'ellipse', x: 0, y: 0, width: 10, height: 6 }).length, 48);
  assert.equal(outlineOfMarkup({ type: 'line', startX: 0, startY: 0, endX: 1, endY: 1 }), null);
});

test('spaces follow their pages; spaces read from a file come in once', () => {
  const moved = spacesOnPages([{ id: 'a', page: 1, points: rect(0, 0, 1, 1) }, { id: 'b', page: 2, points: rect(0, 0, 1, 1) }],
    { 1: 3, 2: null });
  assert.deepEqual(moved.map(s => [s.id, s.page]), [['a', 3]]);
  const doc = { spaces: [normalizeSpace({ id: 'a', page: 1, name: 'A', points: rect(0, 0, 1, 1) })] };
  assert.equal(takeOverSpaces(doc, [{ id: 'a', page: 1, points: rect(0, 0, 1, 1) }, { id: 'b', page: 1, points: rect(0, 0, 2, 2) }]), 1);
  assert.equal(doc._spacesRead, true);
  assert.deepEqual(doc.spaces.map(s => s.id), ['a', 'b']);
});

test('Quantities: the Space field, a filter per space (with sub-spaces) and group by Space', () => {
  const doc = fixture();
  const elements = withSpacePaths(doc.annotations, doc);
  assert.equal(elements.find(e => e.id === 'm3').__space, 'Office ▸ Closet');
  assert.ok(spacePathWithin('Office ▸ Closet', 'Office'));
  assert.ok(!spacePathWithin('Officer', 'Office'));
  const office = elementsInSpace(elements, 'Office');
  assert.deepEqual(office.map(e => e.id).sort(), ['m3', 'm4', 'm8', 'm9']);
  const closet = elementsInSpace(elements, 'Office ▸ Closet');
  assert.deepEqual(closet.map(e => e.id).sort(), ['m3', 'm8']);
  const r = buildSchedule(elements, {
    categories: ['area', 'line-based', 'count', 'text-annotation', 'symbol', 'other'],
    fields: ['space', 'count'],
    filters: [{ field: 'space', op: '=', value: 'Living' }],
    sort: [{ field: 'space', dir: 'asc', group: true }],
  });
  assert.deepEqual(r.groups.map(g => [g.key, g.rows.length]), [['Living', 3]]);
  assert.deepEqual(markupsInSpace(doc, 'office').map(a => a.id).sort(), ['m3', 'm4', 'm8', 'm9']);
  // No spaces: the elements stay as they are.
  const plain = [{ id: 'x' }];
  assert.equal(withSpacePaths(plain, { annotations: [] }), plain);
});
