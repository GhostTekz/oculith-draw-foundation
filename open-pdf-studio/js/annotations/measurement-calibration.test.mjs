import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { calculateDistance, formatMeasurement, getMeasureScale, recalculateAllMeasurements } = await import('./measurement.js');
const { invalidateScaleRegionCache, pixelsPerUnitFor } = await import('./scale-region.js');
const { createMeasurePerimeterAnnotation } = await import('../tools/annotation-creators.js');
const { createScaleBar } = await import('./scale-bar.js');
const { scaleBarTool } = await import('../tools/tools/scalebar-tool.js');
const { annotProps, storeShowProperties, updateAnnotProp } = await import('../solid/stores/propertiesStore.js');

function openDocument({ measureScale = null, annotations = [] } = {}) {
  state.documents = [{ id: `calibration-${Math.random()}`, currentPage: 1,
    annotations, measureScale }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

test('an uncalibrated distance is page-space and says the scale is not set', () => {
  openDocument();
  const distance = calculateDistance(0, 0, 100, 0, 1);
  assert.equal(distance.value, 100);
  assert.equal(distance.unit, 'pt');
  assert.equal(distance.calibrated, false);
  assert.match(formatMeasurement(distance), /Scale not set/u);
  assert.equal(getMeasureScale(1, 50, 0).calibrated, false);
});

test('invalid scale bar and document values leave measurements in page points', () => {
  const doc = openDocument({ measureScale: { pixelsPerUnit: Infinity, unit: 'mm' },
    annotations: [{ type: 'scaleBar', page: 1, pixelsPerUnit: null, unit: '' }] });
  assert.equal(getMeasureScale(1, 50, 0).calibrated, false);
  assert.deepEqual(calculateDistance(0, 0, 100, 0, 1),
    { value: 100, unit: 'pt', pixels: 100, calibrated: false });
  assert.equal(getMeasureScale().calibrated, false);
  assert.equal(doc.annotations[0].pixelsPerUnit, null);
});

test('unsupported document and preference units never label a page distance as physical', () => {
  const doc = openDocument({ measureScale: { pixelsPerUnit: 2, unit: 'furlongs' } });
  state.preferences.measureScale = { pixelsPerUnit: 4, unit: 'yards' };
  const distance = calculateDistance(0, 0, 100, 0, 1);
  assert.deepEqual(distance, { value: 100, unit: 'pt', pixels: 100, calibrated: false });
  assert.match(formatMeasurement(distance), /Scale not set/u);
  doc.measureScale = { pixelsPerUnit: 2 };
  assert.deepEqual(calculateDistance(0, 0, 100, 0, 1),
    { value: 50, unit: 'mm', pixels: 100, calibrated: true });
});

test('document and region calibration retain real physical units and values', () => {
  const doc = openDocument({ measureScale: { pixelsPerUnit: 2, unit: 'mm' } });
  const documentDistance = calculateDistance(0, 0, 100, 0, 1);
  assert.equal(documentDistance.value, 50);
  assert.equal(documentDistance.unit, 'mm');
  assert.equal(documentDistance.calibrated, true);
  assert.equal(formatMeasurement(documentDistance), '50 mm');
  doc.annotations.push({ type: 'scaleRegion', id: 'region', page: 1,
    x: 0, y: 0, width: 100, height: 100, scaleString: '1:100', units: 'cm' });
  invalidateScaleRegionCache();
  const regionDistance = calculateDistance(0, 20, 100, 20, 1);
  assert.equal(regionDistance.calibrated, true);
  assert.equal(regionDistance.unit, 'cm');
  assert.ok(Math.abs(regionDistance.value - 100 / pixelsPerUnitFor('1:100', 'cm')) < 0.001);
  assert.doesNotMatch(formatMeasurement(regionDistance), /Scale not set/u);
});

test('perimeter creation does not report a physical unit without calibration', () => {
  openDocument();
  const perimeter = createMeasurePerimeterAnnotation([{ x: 10, y: 10 }, { x: 110, y: 10 }]);
  assert.equal(perimeter.measureValue, 100);
  assert.equal(perimeter.measureUnit, 'pt');
  assert.match(perimeter.measureText, /Scale not set/u);
});

test('perimeter creation uses the page calibration for value, unit, and label', () => {
  openDocument({ measureScale: { pixelsPerUnit: 2, unit: 'ft' } });
  const perimeter = createMeasurePerimeterAnnotation([{ x: 10, y: 10 }, { x: 110, y: 10 }]);
  assert.equal(perimeter.measureValue, 50);
  assert.equal(perimeter.measureUnit, 'ft');
  assert.equal(perimeter.measureText, '50\'-0"');
});

test('scale refresh keeps uncalibrated distance, area, and perimeter warnings', () => {
  const doc = openDocument({ annotations: [
    { id: 'distance', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 100, endY: 0 },
    { id: 'area', type: 'measureArea', page: 1, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] },
    { id: 'perimeter', type: 'measurePerimeter', page: 1, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
  ] });
  recalculateAllMeasurements();
  assert.deepEqual(doc.annotations.map(a => a.measureUnit), ['pt', 'pt²', 'pt']);
  for (const ann of doc.annotations) assert.match(ann.measureText, /Scale not set/u);
});

test('placing a scale bar cannot invent a document calibration', () => {
  const doc = openDocument();
  assert.equal(createScaleBar(20, 30), null);
  scaleBarTool.onPointerDown({ x: 20, y: 30 }, { button: 0 });
  assert.equal(doc.measureScale, null);
  assert.equal(doc.annotations.length, 0);
  assert.equal(getMeasureScale(1, 20, 30).calibrated, false);
});

test('a scale bar uses the existing document calibration', () => {
  openDocument({ measureScale: { pixelsPerUnit: 0.5, unit: 'ft' } });
  const bar = createScaleBar(20, 30);
  assert.equal(bar.pixelsPerUnit, 0.5);
  assert.equal(bar.unit, 'ft');
  assert.equal(bar.width, bar.totalUnits * 0.5);
});

test('a newly placed bar represents the same five-metre length in every supported unit', () => {
  const expectedWidth = 5 * 1000 * 72 / (25.4 * 100);
  for (const [unit, expectedTotal] of [
    ['mm', 5000], ['cm', 500], ['m', 5],
    ['in', 5000 / 25.4], ['ft', 5000 / 304.8],
  ]) {
    openDocument({ measureScale: { pixelsPerUnit: pixelsPerUnitFor('1:100', unit), unit } });
    const bar = createScaleBar(20, 30);
    assert.equal(bar.unit, unit);
    assert.ok(Math.abs(bar.totalUnits - expectedTotal) < 1e-10, unit);
    assert.ok(Math.abs(bar.width - expectedWidth) < 1e-10, unit);
  }
  openDocument({ measureScale: { pixelsPerUnit: 1, unit: 'furlongs' } });
  assert.equal(createScaleBar(20, 30), null);
  openDocument({ measureScale: { pixelsPerUnit: Number.MAX_VALUE, unit: 'ft' } });
  assert.equal(createScaleBar(20, 30), null);
});

test('editing units on a calibrated bar without stored total keeps its scale finite', () => {
  const bar = { id: 'bar-no-total', type: 'scaleBar', page: 1, x: 20, y: 30,
    width: 120, height: 14, pixelsPerUnit: 2, unit: 'mm', totalUnits: null, divisions: 4 };
  const doc = openDocument({ annotations: [bar] });
  storeShowProperties(bar);
  assert.equal(annotProps.scaleBarTotalUnits, '');
  updateAnnotProp('scaleBarUnit', 'cm');
  assert.equal(bar.unit, 'cm');
  assert.equal(bar.totalUnits, 6);
  assert.equal(bar.pixelsPerUnit, 20);
  assert.equal(doc.measureScale.pixelsPerUnit, 20);
  assert.equal(getMeasureScale(1, 40, 40).unit, 'cm');
  assert.equal(annotProps.scaleBarCalibrated, true);
});

test('a page whose scale was cleared stays uncalibrated despite a document scale', () => {
  const doc = openDocument({ measureScale: { pixelsPerUnit: 18, unit: 'ft', method: 'mcp' } });
  doc.pageScales = { 1: null };
  assert.equal(getMeasureScale(1, 50, 0).calibrated, false, 'with a point');
  assert.equal(getMeasureScale(1).calibrated, false, 'page-wide');
  assert.equal(getMeasureScale(2, 50, 0).unit, 'ft', 'a page without a key still follows the document scale');
});
