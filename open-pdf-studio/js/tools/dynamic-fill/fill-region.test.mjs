import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findFillRegion, gapBridges, simplifyClosed, cleanRing, snapRing, traceContours, signedArea, regionArea,
  regionContains, regionsToRings, polylineSegments, boundarySegments, encirclingLoop, seedsInLoop, regionInsideLoop, pointInRing,
} from './fill-region.js';
import { floorPlanLines, ROOM_A, ROOM_B, COLUMN, PT_PER_FT, EXPECTED_FT2 } from './floor-plan.testhulp.mjs';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} != ${b} (±${eps})`);
const ft2 = (pt2) => pt2 / (PT_PER_FT * PT_PER_FT);

// The plan in annotation space for an unrotated 792 x 612 page: y flips.
const H = 612;
const planSegments = (map = (x, y) => ({ x, y: H - y })) => floorPlanLines().map(([[x1, y1], [x2, y2]]) => {
  const a = map(x1, y1), b = map(x2, y2);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
});
const centre = (r, map = (x, y) => ({ x, y: H - y })) => map(r.x + r.w * 0.25, r.y + r.h * 0.75);
const rect = (x, y, w, h) => polylineSegments([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]);

function sameRing(actual, expected, eps = 1e-6) {
  assert.equal(actual.length, expected.length, `ring ${JSON.stringify(actual)}`);
  for (const e of expected) {
    assert.ok(actual.some((p) => Math.hypot(p.x - e.x, p.y - e.y) <= eps), `corner ${JSON.stringify(e)} in ${JSON.stringify(actual)}`);
  }
}

test('a room with a door gap closes at the gap tolerance and is exact at 1/4" = 1\'-0"', () => {
  const segs = planSegments();
  const a = findFillRegion(segs, centre(ROOM_A), { gap: 60 });
  assert.equal(a.status, 'ok');
  near(ft2(a.area), EXPECTED_FT2.A, 1e-6, 'room A ft²');
  sameRing(a.outer, [
    { x: 100, y: H - 100 }, { x: 460, y: H - 100 }, { x: 460, y: H - 370 }, { x: 100, y: H - 370 },
  ]);
  // Perimeter of the outer ring: 2 x (20 + 15) ft.
  let perim = 0;
  for (let i = 0; i < a.outer.length; i++) {
    const p = a.outer[i], q = a.outer[(i + 1) % a.outer.length];
    perim += Math.hypot(q.x - p.x, q.y - p.y);
  }
  near(perim / PT_PER_FT, 70, 1e-6, 'room A perimeter ft');

  const b = findFillRegion(segs, centre(ROOM_B), { gap: 60 });
  assert.equal(b.status, 'ok');
  near(ft2(b.area), EXPECTED_FT2.B, 1e-6, 'room B ft²');
  assert.equal(b.holes.length, 0);
});

test('without a gap tolerance the fill runs through the door into the next room', () => {
  const r = findFillRegion(planSegments(), centre(ROOM_A));
  assert.equal(r.status, 'ok');
  near(ft2(r.area), EXPECTED_FT2.AB_OPEN, 1e-6, 'A + door + B');
  // A gap smaller than the door does not close it either.
  near(ft2(findFillRegion(planSegments(), centre(ROOM_A), { gap: 40 }).area), EXPECTED_FT2.AB_OPEN, 1e-6);
});

test('a column inside the room becomes a cut-out (island)', () => {
  const r = findFillRegion(planSegments(), centre(ROOM_A), { gap: 60 });
  assert.equal(r.holes.length, 1);
  sameRing(r.holes[0], [
    { x: COLUMN.x, y: H - COLUMN.y }, { x: COLUMN.x + COLUMN.w, y: H - COLUMN.y },
    { x: COLUMN.x + COLUMN.w, y: H - COLUMN.y - COLUMN.h }, { x: COLUMN.x, y: H - COLUMN.y - COLUMN.h },
  ]);
  // Outer ring and island run opposite ways (vlak-ringen.js nesting rule).
  assert.ok(Math.sign(signedArea(r.outer)) !== Math.sign(signedArea(r.holes[0])));
  assert.equal(regionContains(r, COLUMN.x + 5, H - COLUMN.y - 5), false);
  assert.equal(regionContains(r, centre(ROOM_A).x, centre(ROOM_A).y), true);
  // Clicking inside the column fills the column itself.
  const col = findFillRegion(planSegments(), { x: COLUMN.x + 10, y: H - COLUMN.y - 10 });
  near(ft2(col.area), 4, 1e-6, 'column ft²');
  // A gap wider than the column's diagonal does not bridge its corners (they
  // are already joined by the column outline), so it is not cut up.
  const colGap = findFillRegion(planSegments(), { x: COLUMN.x + 10, y: H - COLUMN.y - 10 }, { gap: 60 });
  near(ft2(colGap.area), 4, 1e-6, 'column ft² with gap 60');
});

test('a nested room: the inner room is a hole of the outer, and fills on its own', () => {
  const segs = [...rect(0, 0, 400, 300), ...rect(100, 80, 120, 90)];
  const outer = findFillRegion(segs, { x: 30, y: 30 });
  assert.equal(outer.status, 'ok');
  assert.equal(outer.holes.length, 1);
  near(outer.area, 400 * 300 - 120 * 90, 1e-6);
  const inner = findFillRegion(segs, { x: 150, y: 120 });
  near(inner.area, 120 * 90, 1e-6);
  assert.equal(inner.holes.length, 0);
});

test('a click outside any closed region, or on a line, gives no fill', () => {
  const segs = planSegments();
  assert.equal(findFillRegion(segs, { x: 20, y: 20 }).status, 'open', 'outside the building');
  assert.equal(findFillRegion(segs, { x: 700, y: 300 }).status, 'open', 'right of the building');

  // An open U shape: the fill escapes.
  const u = polylineSegments([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }]);
  const open = findFillRegion(u, { x: 50, y: 50 });
  assert.equal(open.status, 'open');
  // An open result knows its escaped fill, so painting through it is cheap.
  assert.equal(open.escape(50, 90), true, 'same open area');
  assert.equal(open.escape(50, 100), false, 'the line itself is not');
  assert.equal(findFillRegion([...rect(0, 0, 100, 100), { x1: 50, y1: 0, x2: 50, y2: 100 }], { x: 50, y: 50 }).status, 'boundary');
  assert.equal(findFillRegion([], { x: 1, y: 1 }).status, 'empty');
});

test('a temporary boundary line closes an opening, and gives the same exact area', () => {
  const u = polylineSegments([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }]);
  const r = findFillRegion(u, { x: 50, y: 50 }, { boundaries: polylineSegments([{ x: -5, y: 0 }, { x: 105, y: 0 }]) });
  assert.equal(r.status, 'ok');
  near(r.area, 100 * 100, 1e-6);
});

test('a rotated, cropped page gives the same region in its own annotation space', () => {
  // Annotation space of the same plan on a page with /Rotate 90 and a CropBox
  // at (20, 30): x' = y - 30, y' = x - 20 (what pdf-snap-extractor.js gets
  // from the PDF.js viewport). The room is then 15' wide and 20' tall.
  const map = (x, y) => ({ x: y - 30, y: x - 20 });
  const segs = planSegments(map);
  const r = findFillRegion(segs, centre(ROOM_A, map), { gap: 60 });
  assert.equal(r.status, 'ok');
  near(ft2(r.area), EXPECTED_FT2.A, 1e-6);
  sameRing(r.outer, [map(100, 100), map(460, 100), map(460, 370), map(100, 370)]);
  assert.equal(r.holes.length, 1);
});

test('a diagonal (non axis-aligned) room keeps its corners', () => {
  const tri = polylineSegments([{ x: 0, y: 0 }, { x: 300, y: 10 }, { x: 120, y: 250 }, { x: 0, y: 0 }]);
  const r = findFillRegion(tri, { x: 120, y: 80 });
  sameRing(r.outer, [{ x: 0, y: 0 }, { x: 300, y: 10 }, { x: 120, y: 250 }]);
  near(r.area, 0.5 * Math.abs(300 * 250 - 10 * 120), 1e-6);
  // A rotated square (45°): area preserved within snapping.
  const d = 100 / Math.SQRT2;
  const diamond = polylineSegments([{ x: 200, y: 100 }, { x: 200 + d, y: 100 + d }, { x: 200, y: 100 + 2 * d }, { x: 200 - d, y: 100 + d }, { x: 200, y: 100 }]);
  near(findFillRegion(diamond, { x: 200, y: 160 }).area, 100 * 100, 1e-6);
});

test('stray lines inside a room do not cut it', () => {
  const segs = [...rect(0, 0, 300, 200), { x1: 50, y1: 100, x2: 200, y2: 100 }, { x1: 0, y1: 50, x2: 40, y2: 50 }];
  const r = findFillRegion(segs, { x: 250, y: 150 });
  near(r.area, 300 * 200, 1e-6);
  assert.equal(r.holes.length, 0);
});

test('a large sheet only grows the window as far as the room needs', () => {
  // A 36" x 24" sheet full of small rooms; filling one stays quick.
  const segs = [];
  for (let x = 0; x < 2592; x += 72) segs.push({ x1: x, y1: 0, x2: x, y2: 1728 });
  for (let y = 0; y < 1728; y += 72) segs.push({ x1: 0, y1: y, x2: 2592, y2: y });
  segs.push({ x1: 2592, y1: 0, x2: 2592, y2: 1728 }, { x1: 0, y1: 1728, x2: 2592, y2: 1728 });
  const t0 = performance.now();
  const r = findFillRegion(segs, { x: 1300, y: 900 });
  const ms = performance.now() - t0;
  near(r.area, 72 * 72, 1e-6);
  assert.ok(ms < 2000, `took ${ms} ms`);
});

test('gap bridges: endpoint to endpoint, and a short T continued onto its wall', () => {
  const door = [{ x1: 0, y1: 0, x2: 10, y2: 0 }, { x1: 14, y1: 0, x2: 30, y2: 0 }];
  assert.equal(gapBridges(door, 3).length, 0);
  const b = gapBridges(door, 5);
  assert.ok(b.some((s) => Math.hypot(s.x1 - 10, s.y1) < 1e-9 && Math.hypot(s.x2 - 14, s.y2) < 1e-9
    || Math.hypot(s.x2 - 10, s.y2) < 1e-9 && Math.hypot(s.x1 - 14, s.y1) < 1e-9));
  const tee = [{ x1: 0, y1: 0, x2: 100, y2: 0 }, { x1: 50, y1: 40, x2: 50, y2: 3 }];
  const t = gapBridges(tee, 5);
  assert.ok(t.some((s) => s.x2 === 50 && Math.abs(s.y2) < 1e-9), JSON.stringify(t));
  assert.equal(gapBridges(tee, 0).length, 0);
});

test('contour tracing: a cell block gives one clockwise ring, a hole the other way', () => {
  const W = 6, Hh = 5;
  const g = new Uint8Array(W * Hh);
  for (let y = 1; y < 4; y++) for (let x = 1; x < 5; x++) g[y * W + x] = 2;
  g[2 * W + 2] = 0;
  const loops = traceContours(g, W, Hh);
  assert.equal(loops.length, 2);
  const [outer, hole] = loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  assert.equal(outer.length, 4);
  assert.equal(signedArea(outer), 12);
  assert.equal(signedArea(hole), -1);
});

test('contour simplification: a staircase collapses to its corners, collinear points go', () => {
  // A 45° staircase edge of a right triangle (cell size 1).
  const stair = [{ x: 0, y: 0 }];
  for (let i = 0; i < 20; i++) stair.push({ x: i + 1, y: i }, { x: i + 1, y: i + 1 });
  stair.push({ x: 0, y: 20 });
  const s = simplifyClosed(stair, 0.9);
  assert.equal(s.length, 3, JSON.stringify(s));
  // Snapping the simplified corners onto the real lines makes them exact.
  const lines = polylineSegments([{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 }]);
  const snapped = cleanRing(snapRing(s, lines, 3));
  sameRing(snapped, [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]);
  assert.deepEqual(cleanRing([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 0, y: 10 }]),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
});

test('several regions combine: first outer ring, then islands and other regions as rings', () => {
  const segs = planSegments();
  const a = findFillRegion(segs, centre(ROOM_A), { gap: 60 });
  const b = findFillRegion(segs, centre(ROOM_B), { gap: 60 });
  const rings = regionsToRings([a, b]);
  assert.equal(rings.points, a.outer);
  assert.equal(rings.holes.length, 2);
  near(ft2(regionArea(a) + regionArea(b)), EXPECTED_FT2.A + EXPECTED_FT2.B, 1e-6);
  assert.equal(regionsToRings([]), null);
});

test('encircling: a drag that closes on itself is a loop; seeds stay inside it and off the lines', () => {
  const circle = (cx, cy, r, n = 40, close = true) => {
    const pts = [];
    for (let i = 0; i <= (close ? n : n - 8); i++) pts.push({ x: cx + r * Math.cos(2 * Math.PI * i / n), y: cy + r * Math.sin(2 * Math.PI * i / n) });
    return pts;
  };
  assert.ok(encirclingLoop(circle(100, 100, 50), 10), 'closed circle');
  assert.equal(encirclingLoop(circle(100, 100, 50, 40, false), 10), null, 'open arc');
  assert.equal(encirclingLoop([{ x: 0, y: 0 }, { x: 1, y: 0 }], 10), null, 'a click');
  const loop = circle(100, 100, 50);
  const segs = [{ x1: 0, y1: 100, x2: 200, y2: 100 }];
  const seeds = seedsInLoop(loop, segs, { perSide: 20 });
  assert.ok(seeds.length > 100);
  assert.ok(seeds.every((p) => pointInRing(loop, p.x, p.y)));
  assert.ok(seeds.every((p) => Math.abs(p.y - 100) > 0.75), 'none on the line');
  const room = findFillRegion(rect(80, 80, 30, 30), { x: 90, y: 90 });
  assert.equal(regionInsideLoop(room, loop), true);
  const big = findFillRegion(rect(0, 0, 300, 300), { x: 10, y: 10 });
  assert.equal(regionInsideLoop(big, loop), false);
});

test('line weight: unpainted paths never bound; thin strokes only above the minimum', () => {
  const segs = [
    { x1: 0, y1: 0, x2: 1, y2: 0, paint: 's', w: 0.7 },
    { x1: 0, y1: 0, x2: 1, y2: 0, paint: 's', w: 0.1 },
    { x1: 0, y1: 0, x2: 1, y2: 0, paint: 's', w: 0 },
    { x1: 0, y1: 0, x2: 1, y2: 0, paint: 'f', w: 0.05 },
    { x1: 0, y1: 0, x2: 1, y2: 0, paint: 'n', w: 1 },
    { x1: 0, y1: 0, x2: 1, y2: 0 },
  ];
  assert.equal(boundarySegments(segs, 0).length, 5, 'only the clip path goes');
  assert.deepEqual(boundarySegments(segs, 0.25).map((s) => s.paint ?? '-'), ['s', 'f', '-']);
});

test('snapping finds a line just across a cell border of its index', () => {
  // Radius 1.616: x = 286 lies in index cell 176, the corner estimate 286.18
  // in cell 177. The corner must still snap.
  const segs = [{ x1: 286, y1: 376, x2: 286, y2: 412 }, { x1: 250, y1: 376, x2: 286, y2: 376 }];
  const [p] = snapRing([{ x: 286.18, y: 375.65 }], segs, 1.616);
  assert.deepEqual(p, { x: 286, y: 376 });
});

test('a fill on a whole sheet stays within the grid budget and the time', () => {
  // A 36" x 24" sheet with only a border: the fill is the whole sheet.
  const segs = rect(0, 0, 2592, 1728);
  const t0 = performance.now();
  const r = findFillRegion(segs, { x: 1000, y: 800 });
  const ms = performance.now() - t0;
  near(r.area, 2592 * 1728, 1e-6);
  assert.ok(r.cell >= Math.sqrt(2592 * 1728 / 1_000_000) - 1e-9, `cell ${r.cell}`);
  assert.ok(ms < 1500, `took ${ms} ms`);
});
