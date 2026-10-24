import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { diffAnnotationLists } = await import('./compare-annotations.js');
const { buildCompareChangeReport } = await import('./change-report.js');

const count = (overrides = {}) => ({
  type: 'count', x: 143, y: 257, number: 1, categoryId: 'receptacles',
  markerStyle: 'dot', color: '#e11d48', ...overrides,
});

test('a removed count is reported at its visible marker bounds', () => {
  assert.deepEqual(diffAnnotationLists([count()], []), [{
    type: 'removed', source: 'annotation', annType: 'count', label: 'count: receptacles #1',
    x: 132, y: 246, width: 22, height: 22,
  }]);
});

test('count quantity or category changes are reported without moving the marker', () => {
  const original = count();
  assert.deepEqual(diffAnnotationLists([original], [count()]), []);
  for (const update of [{ number: 2 }, { categoryId: 'lighting' }, { markerStyle: 'symbol', symbolId: 'fixture' }]) {
    const [change] = diffAnnotationLists([original], [count(update)]);
    assert.equal(change.type, 'modified');
    assert.equal(change.annType, 'count');
    assert.deepEqual([change.x, change.y, change.width, change.height], [132, 246, 22, 22]);
    assert.match(change.label, /count: receptacles #1 → /);
  }
});

test('co-located counts match by identity before position when list order changes', () => {
  const receptacle = count();
  const lighting = count({ categoryId: 'lighting', number: 2 });
  assert.deepEqual(diffAnnotationLists([receptacle, lighting], [lighting, receptacle]), []);

  const changed = count({ categoryId: 'lighting', number: 3 });
  const revisions = diffAnnotationLists([receptacle, lighting], [changed, receptacle]);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].type, 'modified');
  assert.equal(revisions[0].label, 'count: lighting #2 → lighting #3');
  const csv = buildCompareChangeReport({ oldPath: 'old.pdf', newPath: 'new.pdf',
    oldPage: 1, newPage: 1, changes: revisions });
  assert.match(csv, /count: lighting #2 → lighting #3/);
});
