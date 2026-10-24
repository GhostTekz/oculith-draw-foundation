import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conduitFill, smallestConduitFor, normalizeConductors, conductorArea, conduitArea, fillLimit, fillText,
  fillPercentText, CONDUIT_AREAS, INSULATION_IDS, CONDUCTOR_SIZES,
} from './conduit-fill.js';
import { normalizeRaceway, conduitSizes, CONDUIT_TYPE_IDS } from './raceway.js';
import {
  computeMeasureExtras, measureExtrasToJson, measureExtrasFromJson, setMeasureExtraProp, MEASURE_EXTRA_OUTPUTS,
} from './measure-extras.js';

const near = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);
const QUARTER = { pixelsPerUnit: 18, unit: 'ft', calibrated: true };
const fmt = {
  formatMeasurement: (m) => `${m.value.toFixed(2)} ${m.unit}`,
  formatDimensionText: (m) => `${m.value.toFixed(2)} ${m.unit}`,
};
const emt = (tradeSize) => ({ kind: 'conduit', conduitType: 'EMT', tradeSize });
const thhn = (count, size) => ({ count, size, insulation: 'THHN' });

test('catalogue: every conduit size the raceway offers has a Table 4 area, every insulation every size', () => {
  for (const type of CONDUIT_TYPE_IDS) {
    for (const s of conduitSizes(type)) assert.ok(conduitArea(type, s) > 0, `${type} ${s}`);
    const sizes = conduitSizes(type);
    assert.equal(Object.keys(CONDUIT_AREAS[type]).length, sizes.length, `${type}: Table 4 sizes = raceway sizes`);
    const a = sizes.map((s) => CONDUIT_AREAS[type][s]);
    assert.deepEqual(a, a.slice().sort((x, y) => x - y), `${type} areas grow with the size`);
  }
  for (const id of INSULATION_IDS) for (const s of CONDUCTOR_SIZES) assert.ok(conductorArea(s, id) > 0, `${id} ${s}`);
  assert.equal(conductorArea('12', 'THWN-2'), 0.0133, 'THWN-2 is the THHN row');
  assert.equal(conductorArea('4/0', 'XHHW-2'), 0.3197);
  assert.equal(conductorArea('250 kcmil', 'THHN'), 0.3970);
  assert.equal(conductorArea('13', 'THHN'), null);
  assert.equal(conductorArea('12', 'TW'), null);
});

test('Table 1 limits: 1 conductor 53%, 2 conductors 31%, over 2 40%', () => {
  assert.equal(fillLimit(1), 53);
  assert.equal(fillLimit(2), 31);
  assert.equal(fillLimit(3), 40);
  assert.equal(fillLimit(40), 40);
});

test('3 × 12 AWG THHN in 1/2" EMT: 0.0399 / 0.304 = 13.1%', () => {
  const f = conduitFill(emt('1/2'), [thhn(3, '12')]);
  near(f.conductorAreaIn2, 0.0399);
  assert.equal(f.areaIn2, 0.304);
  near(f.fillPercent, 0.0399 / 0.304 * 100);
  assert.equal(f.limitPercent, 40);
  assert.equal(f.count, 3);
  assert.equal(f.over, false);
  assert.deepEqual(f.unknown, []);
  assert.equal(fillText(f), 'Fill 13% (≤40%)');
});

test('the known "how many fit" answers: 12 × 14 THHN / 9 × 12 THHN fit 1/2" EMT, one more does not', () => {
  assert.equal(conduitFill(emt('1/2'), [thhn(12, '14')]).over, false); // 0.1164 ≤ 0.1216
  assert.equal(conduitFill(emt('1/2'), [thhn(13, '14')]).over, true); // 0.1261
  assert.equal(conduitFill(emt('1/2'), [thhn(9, '12')]).over, false); // 0.1197
  const ten = conduitFill(emt('1/2'), [thhn(10, '12')]); // 0.133 / 0.304 = 43.75%
  assert.equal(ten.over, true);
  assert.equal(fillText(ten), '⚠ fill 44% > 40%');
});

test('one and two conductors use 53% and 31%', () => {
  // 1 × 4/0 THHN (0.3237): 3/4" EMT 60.7% > 53%, 1" EMT 37.5%.
  assert.equal(conduitFill(emt('3/4'), [thhn(1, '4/0')]).over, true);
  const one = conduitFill(emt('1'), [thhn(1, '4/0')]);
  assert.equal(one.limitPercent, 53);
  assert.equal(fillText(one), 'Fill 37% (≤53%)');
  // 2 × 6 THHN (0.1014): 1/2" EMT 33.4% is over 31% (it would pass at 40%).
  const two = conduitFill(emt('1/2'), [thhn(2, '6')]);
  assert.equal(two.limitPercent, 31);
  assert.equal(two.over, true);
  assert.equal(conduitFill(emt('3/4'), [thhn(2, '6')]).over, false);
});

test('smallestConduitFor: the "what size conduit" answer per type', () => {
  assert.equal(smallestConduitFor('EMT', [thhn(3, '12')]), '1/2');
  assert.equal(smallestConduitFor('EMT', [thhn(10, '12')]), '3/4');
  assert.equal(smallestConduitFor('EMT', [thhn(1, '4/0')]), '1');
  assert.equal(smallestConduitFor('EMT', [thhn(2, '6')]), '3/4');
  // 3 × 4/0 + 4 AWG EGC = 1.0535 in²: needs 2.634 in² at 40% → 2" EMT (3.356).
  const feeder = [thhn(3, '4/0'), thhn(1, '4')];
  assert.equal(smallestConduitFor('EMT', feeder), '2');
  near(conduitFill(emt('2'), feeder).fillPercent, 1.0535 / 3.356 * 100, 1e-9);
  // PVC Sch 80 is smaller inside: 2" Sch 80 (2.874 × 40% = 1.1496) still fits.
  assert.equal(smallestConduitFor('PVC80', feeder), '2');
  // 3 × 250 THHN = 1.191 in² > 1.1496: 2-1/2" Sch 80, though 2" EMT (1.342) fits.
  assert.equal(smallestConduitFor('PVC80', [thhn(3, '250')]), '2-1/2');
  assert.equal(smallestConduitFor('EMT', [thhn(3, '250')]), '2');
  assert.equal(smallestConduitFor('EMT', [thhn(30, '500')]), null, 'nothing that size');
  assert.equal(smallestConduitFor('EMT', []), null);
  assert.equal(smallestConduitFor('NOPE', [thhn(3, '12')]), null);
});

test('unknown conductors count for the limit but add no area', () => {
  const f = conduitFill(emt('1/2'), [thhn(1, '12'), { count: 1, size: '13', insulation: 'THHN' }, { count: 1, size: '12', insulation: 'XYZ' }]);
  assert.equal(f.count, 3, 'three conductors: the 40% limit');
  assert.equal(f.limitPercent, 40);
  near(f.conductorAreaIn2, 0.0133);
  assert.equal(f.unknown.length, 2);
  assert.equal(fillText(f), 'Fill ≥4% (≤40%)');
  assert.equal(conduitFill({ kind: 'tray' }, [thhn(3, '12')]), null, 'a tray has no conduit fill');
  assert.equal(conduitFill(emt('1/2'), []), null);
  const noArea = conduitFill({ kind: 'conduit', conduitType: 'EMT', tradeSize: '6' }, [thhn(3, '12')]);
  assert.equal(noArea.areaIn2, null);
  assert.equal(noArea.fillPercent, null);
  assert.equal(fillText(noArea), '');
});

test('a fill just over the limit never reads as the limit', () => {
  assert.equal(fillPercentText({ fillPercent: 40.3, limitPercent: 40, over: true }), '40.3');
  assert.equal(fillPercentText({ fillPercent: 40.03, limitPercent: 40, over: true }), '40.1');
  assert.equal(fillPercentText({ fillPercent: 39.6, limitPercent: 40, over: false }), '40');
});

test('normalisation: raceway.conductors only for conduit, cleaned', () => {
  assert.deepEqual(normalizeConductors([
    { count: '3', size: 12, insulation: 'thwn-2' }, { count: 0, size: '12' }, { size: '250 kcmil' },
    { count: 2, size: '13' }, { count: 1.5, size: '10' }, null, { count: 5000, size: '00', insulation: 'XHHW-2' },
    { count: 1, size: '8', insulation: 'TW' },
  ]), [
    { count: 3, size: '12', insulation: 'THHN' }, { count: 1, size: '250', insulation: 'THHN' },
    { count: 999, size: '2/0', insulation: 'XHHW' },
  ]);
  assert.deepEqual(normalizeConductors('x'), []);
  assert.equal(normalizeConductors(Array.from({ length: 50 }, () => thhn(1, '12'))).length, 30);
  const rw = normalizeRaceway({ kind: 'conduit', conductors: [thhn(3, '12')] });
  assert.deepEqual(rw.conductors, [thhn(3, '12')]);
  assert.equal('conductors' in normalizeRaceway({ kind: 'conduit', conductors: [] }), false, 'no empty list');
  assert.equal('conductors' in normalizeRaceway({ kind: 'tray', conductors: [thhn(3, '12')] }), false);
});

const RUN = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }];
const run = (raceway) => ({ type: 'measurePerimeter', measureKind: 'raceway', raceway, points: RUN });

test('label and takeoff: the fill goes last, the warning when over', () => {
  const ann = run({ kind: 'conduit', conduitType: 'EMT', tradeSize: '1/2', conductors: [thhn(3, '12')] });
  const out = computeMeasureExtras(ann, QUARTER, fmt);
  assert.match(out.measureText, /^14\.\d\d ft · 1\/2" EMT · 1 × 90° · Bends 90° · Fill 13% \(≤40%\)$/u);
  near(out.measureFillPercent, 0.0399 / 0.304 * 100);
  assert.equal(out.measureFillLimit, 40);
  assert.equal(out.measureFillOver, undefined);
  for (const k of ['measureFillPercent', 'measureFillLimit', 'measureFillOver']) assert.ok(MEASURE_EXTRA_OUTPUTS.includes(k));
  const over = computeMeasureExtras(run({ ...ann.raceway, conductors: [thhn(10, '12')] }), QUARTER, fmt);
  assert.match(over.measureText, / · ⚠ fill 44% > 40%$/u);
  assert.equal(over.measureFillOver, true);
  // Without a scale the fill still shows (it does not depend on the drawing scale).
  const none = computeMeasureExtras(ann, { pixelsPerUnit: 1, unit: 'pt', calibrated: false }, fmt);
  assert.match(none.measureText, /^Scale not set · .* · Fill 13% \(≤40%\)$/u);
  // No conductors: label unchanged, no fill values.
  const plain = computeMeasureExtras(run({ kind: 'conduit', tradeSize: '3/4' }), QUARTER, fmt);
  assert.match(plain.measureText, /Bends 90°$/u);
  assert.equal(plain.measureFillPercent, undefined);
});

test('panel edits: conductors and Size conduit through the raceway patch', () => {
  const ann = run({ kind: 'conduit', conduitType: 'EMT', tradeSize: '1/2' });
  ann.subject = '1/2" EMT';
  setMeasureExtraProp(ann, 'raceway', { conductors: [thhn(10, '12')] });
  Object.assign(ann, computeMeasureExtras(ann, QUARTER, fmt));
  assert.equal(ann.measureFillOver, true);
  setMeasureExtraProp(ann, 'raceway', { tradeSize: smallestConduitFor(ann.raceway.conduitType, ann.raceway.conductors) });
  Object.assign(ann, computeMeasureExtras(ann, QUARTER, fmt));
  assert.equal(ann.raceway.tradeSize, '3/4');
  assert.equal(ann.subject, '3/4" EMT');
  assert.equal(ann.measureFillOver, undefined);
  assert.match(ann.measureText, /Fill 25% \(≤40%\)$/u); // 0.133 / 0.533
  assert.deepEqual(ann.raceway.conductors, [thhn(10, '12')], 'rows survive a size change');
  // Becoming a tray drops the conductors and the fill.
  setMeasureExtraProp(ann, 'raceway', { kind: 'tray' });
  Object.assign(ann, computeMeasureExtras(ann, QUARTER, fmt));
  assert.equal(ann.raceway.conductors, undefined);
  assert.equal(ann.measureFillPercent, undefined);
  assert.doesNotMatch(ann.measureText, /Fill/u);
});

test('persistence: conductors and fill through /OPS_MeasureExtra JSON', () => {
  const ann = run({ kind: 'conduit', conduitType: 'PVC40', tradeSize: '1/2', conductors: [thhn(10, '12'), { count: 1, size: '12', insulation: 'XHHW' }] });
  Object.assign(ann, computeMeasureExtras(ann, QUARTER, fmt));
  const back = measureExtrasFromJson('measurePerimeter', measureExtrasToJson(ann));
  assert.deepEqual(back.raceway.conductors, [thhn(10, '12'), { count: 1, size: '12', insulation: 'XHHW' }]);
  near(back.measureFillPercent, (0.133 + 0.0181) / 0.285 * 100);
  assert.equal(back.measureFillLimit, 40);
  assert.equal(back.measureFillOver, true);
  // A run without conductors stores no fill.
  const plain = run({ kind: 'conduit' });
  Object.assign(plain, computeMeasureExtras(plain, QUARTER, fmt));
  const d = JSON.parse(measureExtrasToJson(plain));
  assert.equal(d.out.fill, undefined);
  assert.equal(d.rw.conductors, undefined);
  // Junk in the file is ignored.
  const junk = measureExtrasFromJson('measurePerimeter', JSON.stringify({ v: 1, kind: 'raceway',
    rw: { kind: 'conduit', conductors: [{ count: -1, size: 'x' }] }, out: { fill: 'a', fillLim: 99, fillOver: 'yes' } }));
  assert.equal(junk.raceway.conductors, undefined);
  assert.equal(junk.measureFillPercent, undefined);
  assert.equal(junk.measureFillLimit, undefined);
  assert.equal(junk.measureFillOver, undefined);
});
