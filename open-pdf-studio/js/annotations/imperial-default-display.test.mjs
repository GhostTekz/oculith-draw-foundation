// Imperial takeoff display (the external editor): on a page scale in ft or in without a
// chosen precision, new and recalculated lengths read in feet-inches to
// 1/16"; a decimal precision picked in Set Scale still wins. Areas stay
// decimal sq ft and volumes show cu ft with cu yd beside them.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { calculateDistance, calculateArea, formatMeasurement, applyPageScale } = await import('./measurement.js');
const { invalidateScaleRegionCache } = await import('./scale-region.js');
const { initialSetScaleForm, choosePreset, setScaleCommit } = await import('./set-scale-form.js');
const { computeMeasureExtras } = await import('./measure-extras.js');
const { formatMeasurement: fmt, formatDimensionText } = await import('./measurement.js');

function openDocument(annotations = []) {
  state.documents = [{ id: `imperial-${Math.random()}`, currentPage: 1, scale: 1, pdfDoc: { numPages: 1 },
    viewMode: 'single', annotations, measureScale: null, detectedScale: null,
    undoStack: [], redoStack: [], savedUndoStackLength: 0 }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureRounding = 'none';
  invalidateScaleRegionCache();
  return state.documents[0];
}

// 1/4" = 1'-0": 18 pt per foot. 1" = 20': 72 pt per 20 ft.
const QUARTER = { pixelsPerUnit: 18, unit: 'ft', method: 'ratio', scaleRatio: '1:48' };
const ENG20 = { pixelsPerUnit: 72 / 20, unit: 'ft', method: 'ratio', scaleRatio: '1:240' };

test('180 pt at 1/4" = 1\'-0" is 10\'-0"; at 1" = 20\' it is 50\'-0"', () => {
  openDocument();
  applyPageScale(QUARTER, [1]);
  assert.equal(formatMeasurement(calculateDistance(0, 0, 180, 0, 1)), '10\'-0"');
  applyPageScale(ENG20, [1]);
  assert.equal(formatMeasurement(calculateDistance(0, 0, 180, 0, 1)), '50\'-0"');
});

test('feet-inches round to 1/16" and carry into the next foot', () => {
  openDocument();
  applyPageScale(QUARTER, [1]);
  // 23'-10 1/2" = 286.5 in = 23.875 ft
  assert.equal(formatMeasurement(calculateDistance(0, 0, 18 * 23.875, 0, 1)), '23\'-10 1/2"');
  // 11'-11 31/32" rounds up at 1/16" to 12'-0"
  const ft = (11 * 12 + 11 + 31 / 32) / 12;
  assert.equal(formatMeasurement(calculateDistance(0, 0, 18 * ft, 0, 1)), '12\'-0"');
  // 1/16" survives: 5'-3 1/16"
  assert.equal(formatMeasurement(calculateDistance(0, 0, 18 * (63 + 1 / 16) / 12, 0, 1)), '5\'-3 1/16"');
});

test('recalculated measurements switch to feet-inches; a picked decimal precision wins', () => {
  const doc = openDocument([{ id: 'a', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 180, endY: 0 }]);
  applyPageScale(QUARTER, [1]);
  assert.equal(doc.annotations[0].measureText, '10\'-0"');
  applyPageScale({ ...QUARTER, precision: 2 }, [1]);
  assert.equal(doc.annotations[0].measureText, '10.00 ft');
  applyPageScale({ ...QUARTER, unit: 'in', pixelsPerUnit: 1.5 }, [1]);
  assert.equal(doc.annotations[0].measureText, '10\'-0"', 'an inch scale also reads feet-inches');
});

test('metric scales and uncalibrated pages keep their formatting', () => {
  openDocument();
  applyPageScale({ pixelsPerUnit: 72 / 25.4 / 100 * 1000, unit: 'm', method: 'ratio', scaleRatio: '1:100' }, [1]);
  assert.match(formatMeasurement(calculateDistance(0, 0, 180, 0, 1)), /^\d+\.\d\d m$/u);
  applyPageScale(null, [1]);
  assert.match(formatMeasurement(calculateDistance(0, 0, 180, 0, 1)), /^Scale not set · 180 pt$/u);
});

test('areas are decimal sq ft; volumes are cu ft with cu yd', () => {
  openDocument();
  applyPageScale(QUARTER, [1]);
  const area = calculateArea([{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }], [], 1);
  assert.equal(formatMeasurement(area), '100.00 ft²');
  assert.equal(formatMeasurement({ value: 54, unit: 'ft³', calibrated: true }), '54.00 ft³ (2.00 yd³)');
  const ann = { type: 'measureArea', page: 1, measureKind: 'volume', measureDepth: 0.5, measureDepthUnit: 'ft',
    points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }] };
  const patch = computeMeasureExtras(ann, { ...QUARTER, calibrated: true }, { formatMeasurement: fmt, formatDimensionText });
  assert.equal(patch.measureText, '50.00 ft³ (1.85 yd³)');
});

test('measure extras keep the picked precision for lengths', () => {
  const ann = { type: 'measurePerimeter', page: 1, measureDepth: 10, measureDepthUnit: 'ft',
    points: [{ x: 0, y: 0 }, { x: 180, y: 0 }] };
  const scale = { ...QUARTER, calibrated: true };
  const deflt = computeMeasureExtras(ann, scale, { formatMeasurement: fmt, formatDimensionText });
  assert.match(deflt.measureText, /^10'-0"/u);
  const picked = computeMeasureExtras(ann, { ...scale, precision: 1 }, { formatMeasurement: fmt, formatDimensionText });
  assert.match(picked.measureText, /^10\.0 ft/u);
});

test('Set Scale opens imperial presets at 1/16" feet-inches', () => {
  const form = choosePreset(initialSetScaleForm({}), 'arch:1/4');
  assert.equal(form.precision, 'fi16');
  const r = setScaleCommit(form, { pageNum: 1, pageCount: 1 });
  assert.equal(r.scaleData.precision, 'fi16');
  assert.equal(initialSetScaleForm({ referencePixelLength: 72 }).precision, 'fi16', 'a Calibrate pick in ft');
});
