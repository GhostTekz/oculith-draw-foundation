// "Apply Scale to Viewport" uses the Set Scale editor: an existing viewport
// opens as its preset and precision, a new one at the page scale; Calibrate
// comes back with the picked paper length; Apply stores the equation as the
// viewport's 1:N + unit, its precision, and the equation, and measurements
// inside it follow.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { applyPageScale, calculateDistance, formatMeasurement } = await import('./measurement.js');
const { createScaleRegion, invalidateScaleRegionCache } = await import('./scale-region.js');
const { paginaOfDocumentSchaal } = await import('./schaal-op-punt.js');
const nv = await import('./named-viewports.js');
const { choosePreset } = await import('./set-scale-form.js');
const { initialViewportForm, viewportValuesFromForm, viewportScaleString } = await import('./viewport-scale-form.js');

function openDocument() {
  state.documents = [{ id: `vp-form-${Math.random()}`, currentPage: 1, scale: 1, pdfDoc: { numPages: 1 },
    viewMode: 'single', annotations: [], measureScale: null,
    undoStack: [], redoStack: [], savedUndoStackLength: 0 }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureRounding = 'none';
  invalidateScaleRegionCache();
  return state.documents[0];
}

function newViewport(doc) {
  const ann = createScaleRegion({ page: 1, x: 100, y: 100, width: 300, height: 300, label: '' });
  doc.annotations.push(ann);
  return ann;
}

test('an existing viewport opens as its preset and precision', () => {
  const region = { scaleString: '1:48', units: 'ft', precision: 'fi4' };
  const form = initialViewportForm({ isNew: false }, region, null);
  assert.deepEqual([form.presetId, form.paperText, form.paperUnit, form.realText, form.realUnit, form.precision],
    ['arch:1/4', '1/4', 'in', '1', 'ft', 'fi4']);
  const metric = initialViewportForm({}, { scaleString: '1:20', units: 'mm' }, null);
  assert.deepEqual([metric.presetId, metric.realText, metric.realUnit, metric.precision], ['metric:20', '20', 'mm', 0]);
});

test('a new viewport starts at the page scale, else 1:100', () => {
  const doc = openDocument();
  const ann = newViewport(doc);
  assert.equal(initialViewportForm({ isNew: true }, ann, null).presetId, 'metric:100');
  applyPageScale({ pixelsPerUnit: 72 / 20, unit: 'ft', method: 'ratio', scaleRatio: '1:240',
    equation: { paperValue: 1, paperUnit: 'in', realValue: 20, realUnit: 'ft' } }, [1]);
  const form = initialViewportForm({ isNew: true }, ann, paginaOfDocumentSchaal(doc, 1));
  assert.deepEqual([form.presetId, form.realText, form.realUnit, form.precision], ['eng:20', '20', 'ft', 'fi16']);
});

test('Apply stores 1:N, unit, precision and equation; measurements inside follow', () => {
  const doc = openDocument();
  const ann = newViewport(doc);
  const form = choosePreset(initialViewportForm({ isNew: true }, ann, null), 'arch:1/4');
  const values = viewportValuesFromForm(form, 'Detail 3');
  assert.deepEqual(values, { label: 'Detail 3', scaleString: '1:48', units: 'ft', precision: 'fi16',
    equation: { paperValue: 0.25, paperUnit: 'in', realValue: 1, realUnit: 'ft' } });
  const r = nv.pasViewportToe(ann.id, values, { isNew: true });
  assert.equal(r.ok, true);
  assert.equal(ann.precision, 'fi16');
  // 180 pt at 1/4" = 1'-0" inside the viewport
  assert.equal(formatMeasurement(calculateDistance(150, 150, 330, 150, 1)), '10\'-0"');
  // Reopening shows the same equation and preset.
  const again = initialViewportForm({ isNew: false }, ann, null);
  assert.deepEqual([again.presetId, again.paperText, again.realText, again.precision], ['arch:1/4', '1/4', '1', 'fi16']);
  // A decimal precision picked here wins.
  nv.pasViewportToe(ann.id, viewportValuesFromForm({ ...form, precision: 2 }, 'Detail 3'));
  assert.equal(formatMeasurement(calculateDistance(150, 150, 330, 150, 1)), '10.00 ft');
});

test('the label stays required and an incomplete equation is refused', () => {
  const doc = openDocument();
  const ann = newViewport(doc);
  const form = initialViewportForm({ isNew: true }, ann, null);
  assert.equal(nv.pasViewportToe(ann.id, viewportValuesFromForm(form, '  '), { isNew: true }).fout, 'naam');
  assert.deepEqual(viewportValuesFromForm({ ...form, realText: '' }, 'X'), { error: 'invalidEquation' });
});

test('Calibrate comes back with the picked paper length and the label', () => {
  const left = { ...initialViewportForm({}, { scaleString: '1:48', units: 'ft' }, null), realText: '3' };
  const form = initialViewportForm({ initial: { label: 'Detail 9', form: left }, pickedPoints: 72 }, null, null);
  assert.deepEqual([form.paperText, form.paperUnit, form.realText, form.realUnit, form.fromReference, form.focus],
    ['1', 'in', '', 'ft', true, 'real']);
  const values = viewportValuesFromForm({ ...form, realText: '8' }, 'Detail 9');
  assert.equal(values.scaleString, '1:96');
  // A cancelled pick keeps the form as left.
  const kept = initialViewportForm({ initial: { label: 'Detail 9', form: left } }, null, null);
  assert.equal(kept.realText, '3');
});

test('a calibrated ratio keeps enough digits', () => {
  assert.equal(viewportScaleString(48), '1:48');
  assert.equal(viewportScaleString(53.4217391), '1:53.421739');
  assert.equal(viewportScaleString(0), '');
});
