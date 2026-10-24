// A committed fill may replace the raster contour with one polygonized face.
// The flood stays when the window is large, the command fails, or no face covers the seed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { exactClosedFace, MAX_POLYGONIZE_SEGMENTS } = await import('./fill-exact.js');
const { regionArea, signedArea } = await import('./fill-region.js');

function squareEdges(x0, y0, x1, y1) {
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0 },
    { x1: x1, y1: y0, x2: x1, y2: y1 },
    { x1: x1, y1: y1, x2: x0, y2: y1 },
    { x1: x0, y1: y1, x2: x0, y2: y0 },
  ];
}

function flood(outer, extra = {}) {
  return { status: 'ok', outer, holes: [], area: 1, cell: 0.35, ...extra };
}

function sameCorners(actual, expected) {
  assert.equal(actual.length, expected.length, JSON.stringify(actual));
  for (const point of expected) {
    assert.ok(actual.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 1e-9), JSON.stringify(actual));
  }
}

const SQUARE = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];
const TRIANGLE = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 }];

test('a polygonized square replaces the flood contour', async () => {
  assert.equal(MAX_POLYGONIZE_SEGMENTS, 800);
  const region = flood([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], {
    holes: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
    area: 50,
  });
  const kept = region.outer.map((p) => ({ ...p }));
  const far = { x1: 11.2, y1: 0, x2: 12, y2: 0 };
  const onPad = { x1: 11, y1: 0, x2: 12, y2: 0 };
  let calls = 0;
  const result = await exactClosedFace(
    [...squareEdges(0, 0, 10, 10), far, onPad],
    { x: 5, y: 5 },
    region,
    async (cmd, args) => {
      calls += 1;
      assert.equal(cmd, 'geos_polygonize');
      assert.deepEqual(args.lines, [
        [[0, 0], [10, 0]],
        [[10, 0], [10, 10]],
        [[10, 10], [0, 10]],
        [[0, 10], [0, 0]],
        [[11, 0], [12, 0]],
      ]);
      return [{
        shell: [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
        holes: [],
        area: 100,
      }];
    },
  );
  assert.equal(calls, 1);
  sameCorners(result.outer, SQUARE);
  assert.ok(signedArea(result.outer) > 0);
  assert.deepEqual(result.holes, []);
  assert.equal(regionArea(result), 100);
  assert.equal(result.area, 100);
  assert.equal(result.status, 'ok');
  assert.equal(result.cell, 0.35);
  assert.deepEqual(region.outer, kept, 'the flood object stays put');
});

test('an empty polygonize result keeps the flood', async () => {
  const region = flood(TRIANGLE);
  const result = await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, region, async () => []);
  assert.equal(result, region);
  sameCorners(result.outer, TRIANGLE);
});

test('a face that misses the seed keeps the flood', async () => {
  const region = flood(TRIANGLE);
  let calls = 0;
  const result = await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, region, async () => {
    calls += 1;
    return [{ shell: [[20, 20], [30, 20], [30, 30], [20, 30]], holes: [], area: 100 }];
  });
  assert.equal(calls, 1);
  assert.equal(result, region);
});

test('more than 800 overlapping segments does not call polygonize', async () => {
  const region = flood([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  const segments = Array.from({ length: 801 }, () => ({ x1: 0, y1: 0, x2: 1, y2: 0 }));
  let calls = 0;
  const result = await exactClosedFace(segments, { x: 0.2, y: 0.2 }, region, async () => {
    calls += 1;
    return [];
  });
  assert.equal(calls, 0);
  assert.equal(result, region);
});

test('segments outside the filled window are not polygonized with the room', async () => {
  const region = flood([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  const far = Array.from({ length: 801 }, (_, i) => ({ x1: 100 + i, y1: 100, x2: 100 + i, y2: 101 }));
  let lines = null;
  await exactClosedFace([...far, { x1: 0, y1: 0, x2: 1, y2: 0 }], { x: 0.2, y: 0.2 }, region, async (_cmd, args) => {
    lines = args.lines;
    return [];
  });
  assert.deepEqual(lines, [[[0, 0], [1, 0]]]);
});

test('800 overlapping segments still asks once', async () => {
  const region = flood([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  const segments = Array.from({ length: 800 }, () => ({ x1: 0, y1: 0, x2: 1, y2: 0 }));
  let calls = 0;
  const result = await exactClosedFace(segments, { x: 0.2, y: 0.2 }, region, async () => {
    calls += 1;
    return [];
  });
  assert.equal(calls, 1);
  assert.equal(result, region);
});

test('a missing geometry engine keeps the flood', async () => {
  const region = flood(TRIANGLE);
  const result = await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, region, async () => {
    throw new Error('geometry engine is not linked');
  });
  assert.equal(result, region);
});

test('a non-array polygonize result keeps the flood', async () => {
  const region = flood(TRIANGLE);
  const result = await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, region, async () => null);
  assert.equal(result, region);
});

test('polygonize is not asked when the flood, the seed, or the command is unusable', async () => {
  const region = flood(TRIANGLE);
  let calls = 0;
  const invoke = async () => { calls += 1; return []; };
  const open = { ...region, status: 'open' };
  assert.equal(await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, open, invoke), open);
  const missing = { status: 'ok', holes: [], area: 1, cell: 1 };
  assert.equal(await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, missing, invoke), missing);
  assert.equal(await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, region, null), region);
  assert.equal(await exactClosedFace(squareEdges(0, 0, 10, 10), { x: Number.NaN, y: 5 }, region, invoke), region);
  assert.equal(await exactClosedFace(squareEdges(0, 0, 10, 10), null, region, invoke), region);
  assert.equal(await exactClosedFace([], { x: 5, y: 5 }, region, invoke), region);
  assert.equal(calls, 0);
});

test('the donut faces from GEOS-01 pick the annulus or the hole', async () => {
  const outer = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
  const hole = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]];
  const faces = [
    { shell: outer, holes: [hole], area: 3 },
    { shell: hole, holes: [], area: 1 },
  ];
  const segments = [...squareEdges(0, 0, 2, 2), ...squareEdges(0.5, 0.5, 1.5, 1.5)];
  const region = flood([{ x: -1, y: -1 }, { x: 4, y: -1 }, { x: -1, y: 4 }], { area: 12, cell: 0.1 });
  const invoke = async () => faces;
  const annulus = await exactClosedFace(segments, { x: 0.2, y: 0.2 }, region, invoke);
  assert.equal(regionArea(annulus), 3);
  assert.equal(annulus.holes.length, 1);
  sameCorners(annulus.outer, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]);
  sameCorners(annulus.holes[0], [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }]);
  assert.ok(signedArea(annulus.outer) > 0);
  assert.ok(signedArea(annulus.holes[0]) < 0);
  assert.equal(annulus.status, 'ok');
  assert.equal(annulus.cell, 0.1);

  const insideHole = await exactClosedFace(segments, { x: 1, y: 1 }, region, invoke);
  assert.equal(regionArea(insideHole), 1);
  assert.deepEqual(insideHole.holes, []);
  sameCorners(insideHole.outer, [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }]);
  assert.ok(signedArea(insideHole.outer) > 0);
});

test('the smallest covering face is the contour', async () => {
  const region = flood(TRIANGLE);
  const result = await exactClosedFace(squareEdges(0, 0, 10, 10), { x: 5, y: 5 }, region, async () => [
    { shell: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [], area: 100 },
    { shell: [[4, 4], [6, 4], [6, 6], [4, 6]], holes: [], area: 4 },
    { shell: [[4.5, 4.5], [5.5, 4.5], [5.5, 5.5]], holes: [], area: Number.POSITIVE_INFINITY },
  ]);
  assert.equal(regionArea(result), 4);
  sameCorners(result.outer, [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }]);
});
