// PDF vector snap index: one R-tree item per edge. A long edge far from the
// cursor stays out, a short edge at the cursor is returned once.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const {
  pdfSnapIndex, pdfSnapIndexInSlices, searchPdfSnapIndex, getPdfSnapPointsNear, getPdfEdgeSegmentsNear,
} = await import('./pdf-snap-extractor.js');

test('a long edge across y=0 is absent at y=500; the short edge is present once', () => {
  const longEdge = { x1: 0, y1: 0, x2: 4000, y2: 0 };
  const shortEdge = { x1: 10, y1: 500, x2: 30, y2: 500 };
  const points = [{ x: 20, y: 500, type: 'endpoint' }, { x: 100, y: 0, type: 'endpoint' }];
  const index = pdfSnapIndex(points, [longEdge, shortEdge]);
  const hit = searchPdfSnapIndex(index, 20, 500, 12);
  assert.equal(hit.edges.includes(longEdge), false);
  assert.equal(hit.edges.filter((e) => e === shortEdge).length, 1);
  assert.equal(hit.points.filter((p) => p === points[0]).length, 1);
  assert.equal(hit.points.includes(points[1]), false);
  assert.equal(Object.hasOwn(shortEdge, 'minX'), false);
  assert.equal(Object.hasOwn(points[0], 'minX'), false);

  const wide = searchPdfSnapIndex(index, 20, 500, 80);
  assert.equal(wide.edges.filter((e) => e === shortEdge).length, 1);
});

test('a sliced index returns the same points and edges as one load', async () => {
  const points = [];
  const edges = [];
  for (let i = 0; i < 20000; i++) {
    const x = (i * 17) % 3000;
    const y = (i * 13) % 2000;
    points.push({ id: i, x, y, type: 'endpoint' });
    edges.push({ id: i, x1: x, y1: y, x2: x + (i % 40), y2: y + (i % 7) });
  }
  const once = pdfSnapIndex(points, edges);
  const sliced = await pdfSnapIndexInSlices(points, edges);
  const ids = (list) => list.map((item) => item.id).sort((a, b) => a - b);
  for (const [x, y, radius] of [[10, 10, 12], [1500, 900, 30], [2990, 1990, 80], [0, 0, 1]]) {
    const a = searchPdfSnapIndex(once, x, y, radius);
    const b = searchPdfSnapIndex(sliced, x, y, radius);
    assert.deepEqual(ids(b.points), ids(a.points));
    assert.deepEqual(ids(b.edges), ids(a.edges));
  }
});

test('an uncached page returns no snap points or edges', () => {
  assert.deepEqual(getPdfSnapPointsNear(9, 0, 0, 12), []);
  assert.deepEqual(getPdfEdgeSegmentsNear(9, 0, 0, 12), []);
});
