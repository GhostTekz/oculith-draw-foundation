// Scale entry rules: ratio math, typed lengths and ratios, and the page scale
// the status bar reports. Wrong math here turns every takeoff on a sheet into
// a wrong physical quantity, so the expected values are worked out by hand.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ratioPixelsPerUnit, ratioFromPixelsPerUnit, formatRatio,
  parseLengthInput, parseRatioInput, normalizeRatioInput, pageScaleStatus,
} from './scale-entry.js';

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ''} ${actual} != ${expected}`);

test('1:48 in feet is 18 pt per foot (1/4" = 1\'-0")', () => {
  // 1 ft real = 12/48 in = 0.25 in on paper = 18 pt.
  near(ratioPixelsPerUnit(48, 'ft'), 18);
  near(ratioPixelsPerUnit(parseRatioInput('1/4" = 1\'-0"'), 'ft'), 18);
  // 1/8" = 1'-0" is 1:96 → 9 pt per foot; 1" = 10' is 1:120 → 7.2 pt per foot.
  near(ratioPixelsPerUnit(parseRatioInput('1/8"=1\'-0"'), 'ft'), 9);
  near(ratioPixelsPerUnit(parseRatioInput('1" = 10\''), 'ft'), 7.2);
});

test('ratio math in every supported unit', () => {
  // 1:48 in inches: 1 in real = 1/48 in paper = 1.5 pt.
  near(ratioPixelsPerUnit(48, 'in'), 1.5);
  // 1:100 metric: 1 m real = 10 mm paper = 720/25.4 pt.
  near(ratioPixelsPerUnit(100, 'mm'), 72 / 25.4 / 100);
  near(ratioPixelsPerUnit(100, 'cm'), 72 / 2.54 / 100);
  near(ratioPixelsPerUnit(100, 'm'), 720 / 25.4);
  // The same scale gives the same length in every unit: 1 ft = 304.8 mm.
  near(ratioPixelsPerUnit(50, 'ft') / ratioPixelsPerUnit(50, 'mm'), 304.8, 'ft/mm');
  assert.equal(ratioPixelsPerUnit(100, 'yd'), null);
  assert.equal(ratioPixelsPerUnit(0, 'mm'), null);
  assert.equal(ratioPixelsPerUnit(-5, 'mm'), null);
  for (const unit of ['mm', 'cm', 'm', 'in', 'ft']) {
    near(ratioFromPixelsPerUnit(ratioPixelsPerUnit(75, unit), unit), 75, unit);
  }
});

test('ratio display', () => {
  assert.equal(formatRatio(100), '1:100');
  assert.equal(formatRatio(99.9999), '1:100');
  assert.equal(formatRatio(53.42), '1:53.42');
  assert.equal(formatRatio(NaN), '');
});

test('feet-inch input for ft and in', () => {
  assert.deepEqual(parseLengthInput('10\'-6"', 'ft'), { value: 10.5, unit: 'ft' });
  assert.deepEqual(parseLengthInput('10\' 6"', 'ft'), { value: 10.5, unit: 'ft' });
  assert.deepEqual(parseLengthInput('10\'', 'ft'), { value: 10, unit: 'ft' });
  assert.deepEqual(parseLengthInput('6"', 'ft'), { value: 0.5, unit: 'ft' });
  assert.deepEqual(parseLengthInput('10\'-6"', 'in'), { value: 126, unit: 'in' });
  assert.deepEqual(parseLengthInput('6"', 'in'), { value: 6, unit: 'in' });
  assert.deepEqual(parseLengthInput('10\'-6 1/2"', 'in'), { value: 126.5, unit: 'in' });
  assert.deepEqual(parseLengthInput('10 ft 6 in', 'ft'), { value: 10.5, unit: 'ft' });
  // Typed imperial while the document is metric switches to feet/inches.
  assert.deepEqual(parseLengthInput('10\'-6"', 'mm'), { value: 10.5, unit: 'ft' });
  assert.deepEqual(parseLengthInput('6"', 'mm'), { value: 6, unit: 'in' });
});

test('metric and bare input', () => {
  assert.deepEqual(parseLengthInput('12.3m', 'mm'), { value: 12.3, unit: 'm' });
  assert.deepEqual(parseLengthInput('100 mm', 'ft'), { value: 100, unit: 'mm' });
  assert.deepEqual(parseLengthInput('12,5 cm', 'mm'), { value: 12.5, unit: 'cm' });
  assert.deepEqual(parseLengthInput('25', 'ft'), { value: 25, unit: 'ft' });
});

test('units the measurements cannot use, zero and junk are rejected', () => {
  for (const bad of ['5 km', '3 yd', '2 mi', '10 px', '0', '0 m', '', '  ', 'abc', '-3 m', '10\'-x"']) {
    assert.equal(parseLengthInput(bad, 'mm'), null, bad);
  }
});

test('only 1:N ratios are accepted', () => {
  assert.equal(normalizeRatioInput('1:100'), '1:100');
  assert.equal(normalizeRatioInput(' 1 : 75 '), '1:75');
  assert.equal(normalizeRatioInput('1/50'), '1:50');
  assert.equal(normalizeRatioInput('1:53,42'), '1:53.42');
  assert.equal(normalizeRatioInput('1/4" = 1\'-0"'), '1:48');
  for (const bad of ['2:1', '1:0', '0:5', '1:', ':100', 'abc', '', '100', '1:-5', '3:100']) {
    assert.equal(normalizeRatioInput(bad), null, bad);
  }
});

test('page scale status: not set, detected, document, regions', () => {
  assert.equal(pageScaleStatus(null, 1), null);
  assert.deepEqual(pageScaleStatus({ annotations: [] }, 1), { kind: 'none', regions: false });

  // A detected title-block scale is only a suggestion, never a calibration.
  assert.deepEqual(pageScaleStatus({ annotations: [], detectedScale: { ratio: 100 } }, 1),
    { kind: 'detected', ratio: '1:100', regions: false });

  const doc = {
    measureScale: { pixelsPerUnit: ratioPixelsPerUnit(48, 'ft'), unit: 'ft', method: 'ratio' },
    detectedScale: { ratio: 100 },
    annotations: [{ type: 'scaleRegion', page: 2, x: 0, y: 0, width: 10, height: 10,
      scaleString: '1:20', units: 'mm' }],
  };
  assert.deepEqual(pageScaleStatus(doc, 1),
    { kind: 'set', ratio: '1:48', unit: 'ft', method: 'ratio', regions: false });
  assert.equal(pageScaleStatus(doc, 2).regions, true);
  assert.equal(pageScaleStatus(doc, 2).ratio, '1:48', 'a region never becomes the page scale');

  // Unsupported units stay uncalibrated.
  assert.equal(pageScaleStatus({ measureScale: { pixelsPerUnit: 2, unit: 'yd' }, annotations: [] }, 1).kind, 'none');
  // The legacy preference scale is reported as such.
  assert.equal(pageScaleStatus({ annotations: [] }, 1, { pixelsPerUnit: 72 / 25.4 / 100, unit: 'mm' }).method,
    'preference');
});

test('page scale status reports the scale of the current page', () => {
  const doc = {
    annotations: [],
    pageScales: { 1: { pixelsPerUnit: ratioPixelsPerUnit(48, 'ft'), unit: 'ft', method: 'ratio' }, 3: null },
    measureScale: { pixelsPerUnit: ratioPixelsPerUnit(100, 'mm'), unit: 'mm', method: 'legacy-doc' },
    // Page 3: a full-page /VP from the file (cleared in memory), page 4: one smaller than the page.
    pdfViewports: {
      3: [{ x: 0, y: 0, width: 600, height: 400, pixelsPerUnit: 2, unit: 'mm', paginaSchaal: true }],
      4: [{ x: 0, y: 0, width: 600, height: 400, pixelsPerUnit: ratioPixelsPerUnit(20, 'mm'), unit: 'mm', paginaSchaal: true },
        { x: 10, y: 10, width: 50, height: 50, pixelsPerUnit: 2, unit: 'mm' }],
    },
  };
  assert.deepEqual(pageScaleStatus(doc, 1), { kind: 'set', ratio: '1:48', unit: 'ft', method: 'ratio', regions: false });
  // Page 2 has no page scale: the document fallback.
  assert.equal(pageScaleStatus(doc, 2).ratio, '1:100');
  // Page 3: cleared by the user, so neither the file's full-page viewport nor
  // the document fallback applies: the page is uncalibrated (K-004).
  assert.equal(pageScaleStatus(doc, 3).kind, 'none');
  assert.equal(pageScaleStatus(doc, 3).regions, false, 'a full-page viewport is not a region');
  // Page 4: the full-page viewport is the page scale; the detail is a region.
  assert.deepEqual(pageScaleStatus(doc, 4), { kind: 'set', ratio: '1:20', unit: 'mm', method: 'pdfPage', regions: true });
});
