import assert from 'node:assert/strict';
import test from 'node:test';
import {
  racewayGeometry, racewayDrawing, normalizeRaceway, snapBend, deflectionAt, tradeSizeInches, conduitSizes,
  centreRadiusIn, conduitOD, racewayLabel, fittingsText, offsetPath, stationsAlong, CONDUIT_TYPE_IDS, nextCorner,
  liveLegLines,
} from './raceway.js';
import { computeMeasureExtras, measureExtrasToJson, measureExtrasFromJson, pxPerInchOf, measureKindType, setMeasureExtraProp } from './measure-extras.js';

const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);
// 1/4" = 1'-0": 18 pt per foot, 1.5 pt per inch.
const QUARTER = { pixelsPerUnit: 18, unit: 'ft', calibrated: true };
const PX_IN = 1.5;
const fmt = {
  formatMeasurement: (m) => `${m.value.toFixed(2)} ${m.unit}`,
  formatDimensionText: (m) => `${m.value.toFixed(2)} ${m.unit}`,
};

test('trade sizes and the conduit catalogue', () => {
  assert.equal(tradeSizeInches('1/2'), 0.5);
  assert.equal(tradeSizeInches('1-1/4'), 1.25);
  assert.equal(tradeSizeInches('4'), 4);
  assert.equal(tradeSizeInches('x'), null);
  assert.deepEqual(CONDUIT_TYPE_IDS, ['EMT', 'RMC', 'IMC', 'PVC40', 'PVC80', 'FMC', 'LFMC']);
  assert.equal(conduitSizes('EMT').at(-1), '4', 'EMT stops at 4"');
  assert.equal(conduitSizes('RMC').at(-1), '6');
  assert.equal(conduitOD({ conduitType: 'EMT', tradeSize: '3/4' }), 0.922);
  assert.equal(centreRadiusIn(normalizeRaceway({ kind: 'conduit', conduitType: 'EMT', tradeSize: '1' })), 5.75);
  // A tray elbow radius is to the inside rail: centre line = 12" + width/2.
  assert.equal(centreRadiusIn(normalizeRaceway({ kind: 'tray', widthIn: 24 })), 24);
  assert.equal(racewayLabel(normalizeRaceway({ kind: 'conduit', conduitType: 'PVC40', tradeSize: '2' })), '2" PVC Sch 40');
  assert.equal(racewayLabel(normalizeRaceway({ kind: 'tray', trayStyle: 'basket', widthIn: 12, railIn: 2 })), '12" Basket tray, 2" rail');
});

test('normalising: defaults and invalid values', () => {
  assert.deepEqual(normalizeRaceway({}), { kind: 'conduit', conduitType: 'EMT', tradeSize: '3/4', trueSize: false });
  assert.deepEqual(normalizeRaceway({ kind: 'conduit', conduitType: 'EMT', tradeSize: '6' }).tradeSize, '3/4', 'no 6" EMT');
  assert.deepEqual(normalizeRaceway({ kind: 'tray' }), { kind: 'tray', trayStyle: 'ladder', widthIn: 12, railIn: 4, rungIn: 9 });
  assert.deepEqual(normalizeRaceway({ kind: 'tray', trayStyle: 'basket' }), { kind: 'tray', trayStyle: 'basket', widthIn: 12, railIn: 2, rungIn: 9 });
});

test('corner snapping is relative to the previous segment', () => {
  const east = { x: 1, y: 0 };
  const s1 = snapBend(east, { x: 1, y: 0.9 });          // ~42° → 45°
  assert.equal(s1.deflection, 45);
  near(s1.x, Math.SQRT1_2); near(s1.y, Math.SQRT1_2);
  assert.equal(snapBend(east, { x: 0.1, y: -1 }).deflection, -90);
  assert.equal(snapBend(east, { x: 1, y: 0.05 }).deflection, 0, 'straight on');
  assert.equal(snapBend(east, { x: 1, y: 0.62 }).deflection, 30);
  // Relative: after a 45° leg, a further 45° turn gives a 90° heading.
  const s2 = snapBend({ x: 1, y: 1 }, { x: 0.05, y: 1 });
  assert.equal(s2.deflection, 45);
  near(s2.x, 0, 1e-9); near(s2.y, 1);
});

test('elbows are arcs at the standard radius; developed length = straights + arcs', () => {
  // 3/4" EMT: 4.5" centre-line radius = 6.75 pt at 1/4"=1'-0".
  const rw = { kind: 'conduit', conduitType: 'EMT', tradeSize: '3/4' };
  const pts = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }]; // 10 ft east, 5 ft south
  const g = racewayGeometry(pts, rw, PX_IN);
  const r = 4.5 * PX_IN;
  assert.equal(g.corners.length, 1);
  near(g.corners[0].deg, 90);
  near(g.corners[0].radiusPx, r);
  near(g.straightPx, 270 - 2 * r);
  near(g.arcPx, r * Math.PI / 2);
  near(g.developedPx, 270 - 2 * r + r * Math.PI / 2);
  assert.deepEqual(g.fittings, [{ angle: 90, count: 1 }]);
  near(g.bendTotal, 90);
  // The arc stays tangent: it starts r before the corner and ends r after it.
  assert.ok(g.centre.some((p) => Math.abs(p.x - (180 - r)) < 1e-9 && Math.abs(p.y) < 1e-9));
  assert.ok(g.centre.some((p) => Math.abs(p.x - 180) < 1e-9 && Math.abs(p.y - r) < 1e-9));
  // Every arc point is r from the elbow centre (180 - r, r).
  const arc = g.centre.filter((p) => p.x > 180 - r - 1e-9 && p.y < r + 1e-9 && p.y > -1e-9);
  for (const p of arc) near(Math.hypot(p.x - (180 - r), p.y - r), r, 1e-6, 'on the arc');
});

test('fittings and the bend total; over 360° warns for conduit', () => {
  // A run with 90, 45, 45, 90, 90, 90 degree bends = 450°.
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }, { x: 200, y: 300 },
    { x: 300, y: 300 }, { x: 300, y: 400 }, { x: 200, y: 400 }];
  const g = racewayGeometry(pts, { kind: 'conduit' }, PX_IN);
  assert.deepEqual(g.fittings, [{ angle: 90, count: 4 }, { angle: 45, count: 2 }]);
  near(g.bendTotal, 450);
  assert.equal(fittingsText(g.fittings), '4 × 90°, 2 × 45°');
  const ann = { type: 'measurePerimeter', measureKind: 'raceway', raceway: { kind: 'conduit' }, points: pts };
  const out = computeMeasureExtras(ann, QUARTER, fmt);
  assert.equal(out.measureBendWarning, true);
  assert.match(out.measureText, /Bends 450° ⚠ over 360°$/u);
  assert.equal(measureKindType(ann), 'measureRaceway');
  // A tray never gets the NEC conduit warning.
  const tray = computeMeasureExtras({ ...ann, raceway: { kind: 'tray' } }, QUARTER, fmt);
  assert.equal(tray.measureBendWarning, undefined);
  assert.doesNotMatch(tray.measureText, /Bends/u);
});

test('takeoff in feet at 1/4" = 1\'-0", and never physical without a scale', () => {
  const pts = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }];
  const ann = { type: 'measurePerimeter', measureKind: 'raceway', raceway: { kind: 'conduit', tradeSize: '3/4' }, points: pts };
  const out = computeMeasureExtras(ann, QUARTER, fmt);
  const r = 4.5 * PX_IN;
  near(out.measureValue, (270 - 2 * r + r * Math.PI / 2) / 18, 1e-9);
  assert.equal(out.measureUnit, 'ft');
  assert.match(out.measureText, /^14\.\d\d ft · 3\/4" EMT · 1 × 90° · Bends 90°$/u);
  near(pxPerInchOf(QUARTER), 1.5);
  const none = computeMeasureExtras(ann, { pixelsPerUnit: 1, unit: 'pt', calibrated: false }, fmt);
  assert.equal(none.measureValue, 270, 'sharp corners, page points');
  assert.match(none.measureText, /^Scale not set · 270 pt/u);
  assert.equal(pxPerInchOf({ pixelsPerUnit: 1, unit: 'pt', calibrated: false }), null);
});

test('short legs clamp the elbow radius instead of overlapping', () => {
  const g = racewayGeometry([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], { kind: 'tray', widthIn: 24 }, PX_IN);
  assert.equal(g.corners[0].clamped, true);
  near(g.corners[0].radiusPx, 2);
});

test('tray drawing: rails at ±width/2, ladder rungs every 9", basket mesh 2" × 4"', () => {
  const pts = [{ x: 0, y: 0 }, { x: 180, y: 0 }]; // 10 ft
  const ladder = racewayDrawing(pts, { kind: 'tray', trayStyle: 'ladder', widthIn: 24 }, PX_IN);
  const [left, right] = ladder.lines;
  near(left[0].y, -18); near(right[0].y, 18, 1e-9, '12" either side = 18 pt');
  const rungs = ladder.thin.slice(2); // after the two end caps
  assert.equal(rungs.length, Math.floor((180 - 6.75) / 13.5) + 1, 'every 9" (13.5 pt), first at 4.5"');
  const basket = racewayDrawing(pts, { kind: 'tray', trayStyle: 'basket', widthIn: 12 }, PX_IN);
  const longit = basket.thin.filter((l) => Math.abs(l[0].y - l[l.length - 1].y) < 1e-9 && Math.abs(l[0].x - l[l.length - 1].x) > 100);
  assert.equal(longit.length, 5, '12" wide: wires every 2" between the rails');
  // Conduit: one line by default, two at the OD when true size.
  assert.equal(racewayDrawing(pts, { kind: 'conduit' }, PX_IN).lines.length, 1);
  const ts = racewayDrawing(pts, { kind: 'conduit', tradeSize: '4', conduitType: 'RMC', trueSize: true }, PX_IN);
  near(ts.widthPx, 4.5 * PX_IN);
  // Uncalibrated tray: still a tray (rails and rungs), schematic at 1/8" = 1'-0".
  const sch = racewayDrawing(pts, { kind: 'tray', widthIn: 24 }, null);
  assert.equal(sch.schematic, true);
  assert.equal(sch.lines.length, 2, 'two rails');
  near(sch.widthPx, 24 * 0.75, 1e-9, '24" at 1/8" = 1\'-0" = 18 pt');
  assert.ok(sch.thin.length > 10, 'rungs');
  // Uncalibrated conduit: a centre line.
  assert.equal(racewayDrawing(pts, { kind: 'conduit', trueSize: true }, null).lines.length, 1);
});

test('offset and stations follow an elbow', () => {
  const g = racewayGeometry([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { kind: 'tray', widthIn: 12 }, PX_IN);
  const outer = offsetPath(g.centre, 9);
  assert.equal(outer.length, g.centre.length);
  const st = stationsAlong(g.centre, 10);
  assert.ok(st.length > 15);
  for (const s of st) near(Math.hypot(s.nx, s.ny), 1);
});

test('the raceway survives the /OPS_MeasureExtra JSON', () => {
  const ann = { type: 'measurePerimeter', measureKind: 'raceway',
    raceway: { kind: 'tray', trayStyle: 'basket', widthIn: 18, railIn: 4, rungIn: 9, radiusIn: 24 },
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
  Object.assign(ann, computeMeasureExtras(ann, QUARTER, fmt));
  const back = measureExtrasFromJson('measurePerimeter', measureExtrasToJson(ann));
  assert.equal(back.measureKind, 'raceway');
  assert.deepEqual(back.raceway, ann.raceway);
  assert.deepEqual(back.measureFittings, [{ angle: 90, count: 1 }]);
  near(back.measureBendTotal, 90);
  assert.equal(measureExtrasFromJson('measureArea', measureExtrasToJson(ann)).measureKind, undefined);
});

test('deflection sign follows the turn direction', () => {
  assert.equal(deflectionAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }).sign, 1);
  assert.equal(deflectionAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }).sign, -1);
});

test('drawing: the next corner snaps relative to the previous leg; Alt is free; object snap on the ray wins', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const p = nextCorner(pts, 160, 52);                         // ~41° off the leg → 45°
  near(p.x - 100, p.y, 1e-9, 'on the 45° ray');
  near(Math.hypot(p.x - 100, p.y), (60 + 52) / Math.SQRT2, 1e-9, 'cursor distance along the ray');
  assert.equal(p.deflection, 45);
  const q = nextCorner(pts, 102, 80);                         // nearly straight down → 90°
  near(q.x, 100, 1e-9); near(q.y, 80, 1e-9);
  assert.deepEqual(nextCorner(pts, 160, 52, { free: true }), { x: 160, y: 52 });
  // Only 90° allowed: a 45°-ish cursor goes to 90° (the closer of 0/90).
  const r = nextCorner(pts, 150, 60, { angles: [90] });
  assert.equal(r.deflection, 90);
  // An object-snap point on the ray is used exactly.
  const s = nextCorner(pts, 150, 49, { snap: { x: 150.5, y: 50.4 }, tol: 1 });
  assert.deepEqual([s.x, s.y], [150.5, 50.4]);
  // The first leg is free (no previous leg).
  assert.deepEqual(nextCorner([{ x: 0, y: 0 }], 33, 17), { x: 33, y: 17 });
});

test('editing a run after drawing (as-built): settings patch, subject follows the automatic label', () => {
  const ann = { type: 'measurePerimeter', measureKind: 'raceway', raceway: normalizeRaceway({ kind: 'conduit' }),
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], subject: '3/4" EMT' };
  setMeasureExtraProp(ann, 'raceway', { tradeSize: '2', conduitType: 'RMC' });
  assert.equal(ann.raceway.tradeSize, '2');
  assert.equal(ann.subject, '2" RMC');
  setMeasureExtraProp(ann, 'raceway', { radiusIn: 12 });
  assert.equal(ann.raceway.radiusIn, 12);
  setMeasureExtraProp(ann, 'raceway', { radiusIn: null });
  assert.equal(ann.raceway.radiusIn, undefined, 'back to the standard radius');
  ann.subject = 'Feeder A';
  setMeasureExtraProp(ann, 'raceway', { kind: 'tray' });
  assert.equal(ann.raceway.kind, 'tray');
  assert.equal(ann.subject, 'Feeder A', 'a subject the user typed stays');
  const plain = { type: 'measurePerimeter', points: [] };
  setMeasureExtraProp(plain, 'raceway', { kind: 'tray' });
  assert.equal(plain.raceway, undefined, 'only raceway runs take raceway settings');
});

test('pull boxes split the NEC bend count; risers and drops are 90° vertical bends', async () => {
  const { bendsText, normalizeMarks } = await import('./raceway.js');
  // Zig-zag: corners 1..5 are 90° each (450° in total).
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 },
    { x: 300, y: 200 }, { x: 300, y: 300 }];
  const plain = racewayGeometry(pts, { kind: 'conduit' }, PX_IN);
  assert.deepEqual(plain.bendSections, [450]);
  // A pull box at corner 3: no elbow there, two sections of 180°.
  const pulled = racewayGeometry(pts, { kind: 'conduit', marks: { 3: 'pull' } }, PX_IN);
  assert.deepEqual(pulled.bendSections, [180, 180]);
  assert.equal(pulled.corners.length, 4, 'the pull box corner has no elbow');
  assert.ok(pulled.centre.some((p) => p.x === 200 && p.y === 100), 'the centre line still turns at the pull box');
  assert.deepEqual(pulled.fittings, [{ angle: 90, count: 4 }, { angle: 'pull', count: 1 }]);
  assert.equal(bendsText(pulled.bendSections), 'Bends 180° | 180°');
  // A riser at the start and a drop at the end add 90° each.
  const vert = racewayGeometry([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { kind: 'conduit', marks: { 0: 'up', 2: 'down' } }, PX_IN);
  assert.deepEqual(vert.bendSections, [270]);
  assert.equal(fittingsText(vert.fittings), '1 × 90°, 1 × 90° up, 1 × 90° down');
  assert.equal(vert.marks.length, 2);
  // Warning on the worst section only.
  const ann = (marks) => ({ type: 'measurePerimeter', measureKind: 'raceway', raceway: { kind: 'conduit', marks, tag: 'C-12' }, points: pts });
  const over = computeMeasureExtras(ann({}), QUARTER, fmt);
  assert.equal(over.measureBendWarning, true);
  const ok = computeMeasureExtras(ann({ 3: 'pull' }), QUARTER, fmt);
  assert.equal(ok.measureBendWarning, undefined, 'each pull section is under 360°');
  assert.match(ok.measureText, /^C-12 · .* · Bends 180° \| 180°$/u);
  assert.deepEqual(ok.measureBendSections, [180, 180]);
  // Symbols are drawn (and saved) with the run.
  const d = racewayDrawing(pts, { kind: 'conduit', marks: { 3: 'pull', 0: 'up' } }, PX_IN);
  assert.equal(d.lines.length, 1 + 1 + 2, 'centre line, pull-box square, riser circle + dot');
  assert.deepEqual(normalizeMarks({ 1: 'pull', x: 'up', 2: 'sideways', '-1': 'down' }), { 1: 'pull' });
  // Marks and tag persist; an empty patch clears them.
  const a = ann({ 3: 'pull' });
  Object.assign(a, computeMeasureExtras(a, QUARTER, fmt));
  const back = measureExtrasFromJson('measurePerimeter', measureExtrasToJson(a));
  assert.deepEqual(back.raceway.marks, { 3: 'pull' });
  assert.equal(back.raceway.tag, 'C-12');
  assert.deepEqual(back.measureFittings.at(-1), { angle: 'pull', count: 1 });
  setMeasureExtraProp(a, 'raceway', { marks: {} });
  assert.equal(a.raceway.marks, undefined);
  assert.equal(a.raceway.tag, 'C-12');
});

// The leg under the cursor is not a tray or a true-size conduit offset. A
// cursor that doubles back stays on the segment just drawn: two rails at
// the half-width, or one centre line. Nothing lands off that segment.
test('live leg stays on the segment under the cursor for tray and conduit', () => {
  assert.deepEqual(liveLegLines({ x: 0, y: 0 }, { x: 0, y: 0 }, 12), []);
  assert.equal(liveLegLines({ x: 0, y: 0 }, { x: 80, y: 0 }, 0).length, 1, 'schematic conduit is one line');
  const rails = liveLegLines({ x: 300, y: 0 }, { x: 0, y: 0.5 }, 18);
  assert.equal(rails.length, 2, 'tray or true-size conduit is two rails');
  const ax = 300, ay = 0, bx = 0, by = 0.5;
  const ab = Math.hypot(bx - ax, by - ay);
  for (const line of rails) {
    assert.equal(line.length, 2);
    for (const p of line) {
      const t = ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / (ab * ab);
      const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
      assert.ok(t >= -1e-9 && t <= 1 + 1e-9, `rail point off the segment ${t}`);
      near(Math.hypot(p.x - cx, p.y - cy), 18, 1e-6, 'rail stays at the half-width');
    }
  }
});

// A run that nearly doubles back (the live preview with the cursor just past
// the last corner, or a tight U-turn): the inside rail's straight parts are
// almost parallel and used to be joined where they meet, thousands of px
// away. Every rail, rung and end plate stays near the run.
test('tray rails stay at the run near a U-turn and with the cursor at the last corner', () => {
  const near = (p, poly) => {
    let best = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
    return best;
  };
  const runs = [
    [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 0.5 }],
    [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 299, y: 297 }],
    [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 302, y: 296.5 }],
  ];
  for (const trayStyle of ['ladder', 'basket']) {
    for (const pts of runs) {
      const d = racewayDrawing(pts, { kind: 'tray', widthIn: 24, trayStyle }, 1);
      const h = d.widthPx / 2;
      for (const line of [...d.lines, ...d.thin]) {
        for (const p of line) assert.ok(near(p, pts) <= 5 * h + 1e-6, `${trayStyle}: ${JSON.stringify(p)} is ${near(p, pts).toFixed(1)} px off the run`);
      }
    }
  }
});
