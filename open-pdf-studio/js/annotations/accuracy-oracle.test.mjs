// Accuracy oracle: known lengths and areas must stay inside 1e-6 page point.
// Stored geometry is PDF page space (origin bottom-left, y up, unrotated).
// Display is top-left, y down, after /Rotate. Screen pixels are not measured.

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const {
  calculateArea, calculateDistance, formatMeasurement, getMeasureScale, writeEngineArea,
} = await import('./measurement.js');
const { invalidateScaleRegionCache, pixelsPerUnitFor } = await import('./scale-region.js');
const { viewportNaarPagina, viewportNaarScherm } = await import('../pdf/weergave-rotatie.js');
const { COLUMN, EXPECTED_FT2, PT_PER_FT, ROOM_A, floorPlanPdf } = await import('../tools/dynamic-fill/floor-plan.testhulp.mjs');
const { fieldByKey } = await import('../quantities/categories.js');

const TOL = 1e-6;
const CROP = [81, 47, 600, 520];

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) <= TOL, `${msg}: ${actual} != ${expected}`);

function ring(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function openDocument({ measureScale = null } = {}) {
  state.documents = [{
    id: `accuracy-${Math.random()}`, currentPage: 1, annotations: [], measureScale,
  }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureRounding = 'none';
  invalidateScaleRegionCache();
  return state.documents[0];
}

function quarterInchScale() {
  const pixelsPerUnit = pixelsPerUnitFor('1:48', 'ft');
  assert.ok(pixelsPerUnit != null);
  near(pixelsPerUnit, PT_PER_FT, '1/4 in = 1 ft');
  return { pixelsPerUnit, unit: 'ft' };
}

// Same round trip as the cropped /Rotate 90 sheet test: PDF user space to the
// PDF.js viewport, through the view-rotation helper, and back. Zoom and the
// pan offset stay on the screen point and are not part of the stored length.
function pagePointAfterRotate(nativeViewport, appView, x, y) {
  const [px, py] = nativeViewport.convertToViewportPoint(x, y);
  const screen = viewportNaarScherm(appView, px, py);
  return viewportNaarPagina(appView, screen.x, screen.y);
}

describe('accuracy oracle', { concurrency: false }, () => {
  test('room A net area subtracts the column hole', () => {
    assert.equal(PT_PER_FT, 18);
    assert.equal(ROOM_A.w, 20 * PT_PER_FT);
    assert.equal(ROOM_A.h, 15 * PT_PER_FT);
    assert.equal(COLUMN.w, 2 * PT_PER_FT);
    assert.equal(COLUMN.h, 2 * PT_PER_FT);
    openDocument({ measureScale: quarterInchScale() });
    const room = ring(ROOM_A.x, ROOM_A.y, ROOM_A.w, ROOM_A.h);
    const column = ring(COLUMN.x, COLUMN.y, COLUMN.w, COLUMN.h);
    const net = calculateArea(room, [column], 1);
    near(net.pixels, 95904, 'page points squared');
    near(net.pixels, ROOM_A.w * ROOM_A.h - COLUMN.w * COLUMN.h, '97200 minus 1296');
    near(net.value, 296, 'ft²');
    near(net.value, EXPECTED_FT2.A, 'room A');
    assert.equal(net.unit, 'ft²');
    assert.equal(net.calibrated, true);
    assert.equal(formatMeasurement(net), '296.00 ft²');
    const gross = calculateArea(room, undefined, 1);
    near(gross.pixels, 97200, 'column must be passed as a hole');
    near(gross.value, 300, 'gross ft²');
  });

  test('a 10 ft segment stays 180 page points through a /Rotate 90 display round trip', async () => {
    const bytes = await floorPlanPdf({ rotate: 90, cropBox: CROP });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0,
    });
    try {
      const pdf = await loading.promise;
      const readPage = await pdf.getPage(1);
      const nativeViewport = readPage.getViewport({ scale: 1 });
      assert.equal(readPage.rotate, 90);
      assert.equal(readPage.view[0], CROP[0]);
      assert.equal(readPage.view[1], CROP[1]);
      openDocument({ measureScale: quarterInchScale() });

      const x0 = 100;
      const y0 = 200;
      const x1 = x0 + 10 * PT_PER_FT;
      // Stored geometry is the unrotated page point. The CropBox origin is not
      // subtracted from it; a nonzero crop does not change this length.
      const stored = calculateDistance(x0, y0, x1, y0, 1);
      near(stored.pixels, 180, 'stored page points');
      near(stored.value, 10, 'ft');
      assert.equal(stored.unit, 'ft');
      assert.equal(formatMeasurement(stored), '10\'-0"');
      assert.notEqual(stored.pixels, Math.hypot(x1 - CROP[0], y0 - CROP[1]));

      const appView = {
        pageW: nativeViewport.width, pageH: nativeViewport.height,
        rotation: 0, viewRotation: 270, zoom: 1.25, offsetX: -75, offsetY: 35,
      };
      const [dispX, dispY] = nativeViewport.convertToViewportPoint(x0, y0);
      const [dispX1, dispY1] = nativeViewport.convertToViewportPoint(x1, y0);
      const screenStart = viewportNaarScherm(appView, dispX, dispY);
      const screenEnd = viewportNaarScherm(appView, dispX1, dispY1);
      const backStart = pagePointAfterRotate(nativeViewport, appView, x0, y0);
      const backEnd = pagePointAfterRotate(nativeViewport, appView, x1, y0);
      assert.ok(Math.abs(Math.hypot(screenEnd.x - screenStart.x, screenEnd.y - screenStart.y) - 180) > 1,
        'zoomed display pixels are not the stored length');
      const mapped = calculateDistance(backStart.x, backStart.y, backEnd.x, backEnd.y, 1);
      near(mapped.pixels, 180, 'page points after /Rotate 90');
      near(mapped.value, 10, 'ft after /Rotate 90');
      assert.equal(mapped.unit, 'ft');
      assert.ok(screenStart.x !== backStart.x || screenStart.y !== backStart.y);
    } finally {
      await loading.destroy();
    }
  });

  test('a 1 ft square is 324 page points squared and the crop origin is not removed from stored points', async () => {
    const bytes = await floorPlanPdf({ rotate: 90, cropBox: CROP });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0,
    });
    try {
      const readPage = await (await loading.promise).getPage(1);
      assert.deepEqual(readPage.view.slice(0, 2), [CROP[0], CROP[1]], 'CropBox origin is nonzero');
      openDocument({ measureScale: quarterInchScale() });
      const x = 120;
      const y = 220;
      // The square is stored in page points. Do not subtract the CropBox origin.
      const square = ring(x, y, PT_PER_FT, PT_PER_FT);
      const area = calculateArea(square, undefined, 1);
      near(area.pixels, 324, 'page points squared');
      near(area.value, 1, 'ft²');
      assert.equal(area.unit, 'ft²');
      assert.equal(formatMeasurement(area), '1.00 ft²');
      const side = calculateDistance(square[0].x, square[0].y, square[1].x, square[1].y, 1);
      near(side.pixels, PT_PER_FT, 'stored side');
      near(side.value, 1, 'stored side in ft');
      assert.deepEqual([square[0].x, square[0].y], [x, y]);
      assert.ok(x > readPage.view[0] && y > readPage.view[1]);
    } finally {
      await loading.destroy();
    }
  });

  test('an outer 4 by 3 rectangle with a 1 by 1 hole has area 11', () => {
    openDocument();
    const outer = ring(0, 0, 4, 3);
    const hole = ring(1, 1, 1, 1);
    const area = calculateArea(outer, [hole], 1);
    near(area.pixels, 11, 'page points squared');
    near(area.value, 11, 'uncalibrated value');
    assert.equal(area.unit, 'pt²');
    assert.equal(area.calibrated, false);
  });

  test('two 1 by 1 squares separated by 0.01 page point stay separate', () => {
    openDocument();
    const left = calculateArea(ring(0, 0, 1, 1), undefined, 1);
    const right = calculateArea(ring(1.01, 0, 1, 1), undefined, 1);
    near(left.pixels, 1, 'left');
    near(right.pixels, 1, 'right');
    near(left.pixels + right.pixels, 2, 'sum');
    near(left.value + right.value, 2, 'uncalibrated sum');
    assert.ok(Math.abs((left.pixels + right.pixels) - 2.01) > TOL, 'the gap is not bridged');
  });

  test('a bowtie keeps shoelace 0 and a stubbed engine total of 0.5 is stored uncalibrated', () => {
    openDocument();
    const bowtie = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const shoelace = calculateArea(bowtie, undefined, 1);
    near(shoelace.pixels, 0, 'shoelace');
    near(shoelace.value, 0, 'shoelace value');
    assert.equal(getMeasureScale(1, 0.5, 0.5).pixelsPerUnit, 1);
    const ann = { type: 'measureArea', page: 1, points: bowtie };
    assert.equal(writeEngineArea(ann, 0.5), true);
    near(ann.measureValue, 0.5, 'engine page points divided by the uncalibrated scale');
    assert.equal(ann.measureUnit, 'pt²');
    assert.equal(ann.measureText, 'Scale not set · 0.5 pt²');
  });

  test('a store that already read the shoelace shows the engine area', async () => {
    openDocument();
    const { createMutable } = await import('solid-js/store');
    const { createRenderEffect, createRoot } = await import('solid-js');
    const bowtie = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const ann = {
      type: 'measureArea', page: 1, points: bowtie,
      measureValue: 0, measureUnit: 'pt²', measureText: 'Scale not set · 0 pt²',
    };
    const doc = createMutable({ annotations: [ann] });
    createRoot((dispose) => {
      let seen;
      createRenderEffect(() => {
        seen = doc.annotations[0].measureValue;
      });
      assert.equal(seen, 0);
      assert.equal(writeEngineArea(ann, 0.5), true);
      assert.equal(doc.annotations[0].measureValue, 0.5);
      assert.equal(doc.annotations[0].measureUnit, 'pt²');
      assert.equal(doc.annotations[0].measureText, 'Scale not set · 0.5 pt²');
      dispose();
    });
  });

  test('a circle and an axis-aligned rectangle use the quantity formulas', () => {
    const area = fieldByKey(['area'], 'area');
    assert.ok(area);
    assert.equal(area.get({ type: 'circle', width: 2, height: 2 }), Math.PI);
    assert.equal(area.get({ type: 'box', width: 4, height: 3 }), 12);
    assert.equal(area.get({ type: 'box', width: PT_PER_FT, height: PT_PER_FT }), 324);
  });

  test('1:100 millimetres, 18 pt/ft, and an uncalibrated page keep their units', () => {
    const mmPerUnit = pixelsPerUnitFor('1:100', 'mm');
    openDocument({ measureScale: { pixelsPerUnit: mmPerUnit, unit: 'mm' } });
    const millimetres = calculateDistance(0, 0, 100 * mmPerUnit, 0, 1);
    near(millimetres.pixels, 100 * mmPerUnit, 'paper points for 100 mm');
    near(millimetres.value, 100, 'mm');
    assert.equal(millimetres.unit, 'mm');
    assert.equal(millimetres.calibrated, true);
    assert.equal(formatMeasurement(millimetres), '100 mm');

    openDocument({ measureScale: quarterInchScale() });
    const feet = calculateDistance(0, 0, 10 * PT_PER_FT, 0, 1);
    near(feet.pixels, 180, 'page points');
    near(feet.value, 10, 'ft');
    assert.equal(feet.unit, 'ft');
    assert.equal(formatMeasurement(feet), '10\'-0"');

    openDocument();
    const raw = calculateDistance(0, 0, 180, 0, 1);
    near(raw.pixels, 180, 'uncalibrated page points');
    near(raw.value, 180, 'uncalibrated value');
    assert.equal(raw.unit, 'pt');
    assert.equal(raw.calibrated, false);
    assert.equal(getMeasureScale(1, 90, 0).calibrated, false);
    assert.equal(formatMeasurement(raw), 'Scale not set · 180 pt');
  });
});
