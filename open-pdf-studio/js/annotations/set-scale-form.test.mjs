// What the Set Scale dialog shows on open and what Apply commits.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialSetScaleForm, changeRealUnit, choosePreset, presetAfterEdit, setScaleCommit, setScalePages, formRatioText,
} from './set-scale-form.js';
import { ratioPixelsPerUnit } from './scale-entry.js';

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected)), `${msg ?? ''} ${actual} != ${expected}`);
const target = { pageNum: 2, pageCount: 5 };

test('a page without a scale opens on 1:100 for the current page', () => {
  const form = initialSetScaleForm({ pageNum: 2 });
  assert.equal(form.presetId, 'metric:100');
  assert.equal(form.pagesMode, 'current');
  assert.deepEqual([form.paperText, form.paperUnit, form.realText, form.realUnit], ['1', 'mm', '100', 'mm']);
  const r = setScaleCommit(form, target);
  assert.deepEqual(r.pages, [2]);
  near(r.scaleData.pixelsPerUnit, ratioPixelsPerUnit(100, 'mm'));
  assert.equal(r.scaleData.precision, 0);
});

test('an existing scale opens as its preset and precision', () => {
  const form = initialSetScaleForm({}, { pixelsPerUnit: 18, unit: 'ft', precision: 'fi8',
    equation: { paperValue: 0.25, paperUnit: 'in', realValue: 1, realUnit: 'ft' } });
  assert.equal(form.presetId, 'arch:1/4');
  assert.deepEqual([form.paperText, form.realText, form.realUnit, form.precision], ['1/4', '1', 'ft', 'fi8']);
  const custom = initialSetScaleForm({}, { pixelsPerUnit: 72 / 7, unit: 'ft', precision: 'f16' });
  assert.equal(custom.presetId, 'custom');
  assert.deepEqual([custom.paperText, custom.paperUnit, custom.realText], ['1', 'in', '7']);
  assert.equal(custom.precision, 'fi16', 'an invalid stored precision falls back to the unit default');
});

test('a detected title-block scale prefills a metric preset', () => {
  assert.equal(initialSetScaleForm({ detectedRatio: 50 }).presetId, 'metric:50');
  const odd = initialSetScaleForm({ detectedRatio: 75 });
  assert.equal(odd.presetId, 'custom');
  assert.equal(odd.realText, '75');
});

test('a picked length fills the paper side in paper units and focuses the real length', () => {
  // 54 pt = 0.75 in on paper. Without a scale the pick is imperial.
  const form = initialSetScaleForm({ referencePixelLength: 54, pageNum: 1 });
  assert.deepEqual([form.paperText, form.paperUnit, form.realText, form.realUnit], ['0.75', 'in', '', 'ft']);
  assert.equal(form.focus, 'real');
  assert.equal(form.presetId, 'custom');
  assert.equal(setScaleCommit(form, target).error, 'invalidEquation', 'the real length is still to be typed');
  const r = setScaleCommit({ ...form, realText: '10\'-6"' }, target);
  near(r.scaleData.pixelsPerUnit, 54 / 10.5);
  assert.equal(r.scaleData.method, 'reference');
  // With an existing metric scale the paper side is in mm (72 pt = 25.4 mm).
  const metric = initialSetScaleForm({ referencePixelLength: 72 }, { pixelsPerUnit: ratioPixelsPerUnit(100, 'mm'), unit: 'mm' });
  assert.deepEqual([metric.paperText, metric.paperUnit, metric.realUnit], ['25.4', 'mm', 'mm']);
});

test('the draft kept during Calibrate comes back with the picked length', () => {
  const draft = { pagesMode: 'custom', rangeText: '1-3,5', paperUnit: 'mm', realUnit: 'm', realText: '5', precision: 3 };
  const form = initialSetScaleForm({ referencePixelLength: 72, draft }, { pixelsPerUnit: 18, unit: 'ft' });
  assert.deepEqual([form.pagesMode, form.rangeText, form.paperUnit, form.paperText, form.realUnit, form.realText,
    form.precision], ['custom', '1-3,5', 'mm', '25.4', 'm', '', 3]);
  const r = setScaleCommit({ ...form, realText: '2.54' }, target);
  assert.deepEqual(r.pages, [1, 2, 3, 5]);
  // 25.4 mm paper = 2.54 m real: 1:100.
  near(r.scaleData.pixelsPerUnit, ratioPixelsPerUnit(100, 'm'));
  assert.equal(r.scaleData.scaleRatio, '1:100');
  assert.equal(r.scaleData.precision, 3);
});

test('presets, unit changes and edits', () => {
  let form = initialSetScaleForm({});
  form = choosePreset(form, 'arch:1/4');
  assert.deepEqual([form.paperText, form.paperUnit, form.realText, form.realUnit, form.precision],
    ['1/4', 'in', '1', 'ft', 'fi16'], 'a new real unit starts at its default precision (feet-inches)');
  form = { ...form, precision: 2 };
  assert.equal(choosePreset(form, 'arch:1/8').precision, 2, 'same unit keeps the precision');
  form = changeRealUnit(form, 'in');
  assert.deepEqual([form.presetId, form.realText, form.realUnit], ['arch:1/4', '12', 'in'], 'a preset keeps its scale');
  form = choosePreset(form, 'metric:100');
  assert.deepEqual([form.paperUnit, form.realText, form.realUnit], ['mm', '100', 'mm'], 'inches are not metric');
  form = changeRealUnit(form, 'm');
  assert.equal(form.realText, '0.1');
  form = changeRealUnit({ ...choosePreset(form, 'custom'), precision: 'fi16' }, 'mm');
  assert.equal(form.precision, 0, 'feet-inches cannot be shown in mm');
  // Custom: a unit change keeps the typed number.
  form = changeRealUnit({ ...form, presetId: 'custom', paperText: '1', paperUnit: 'in', realText: '8', realUnit: 'ft' }, 'in');
  assert.equal(form.realText, '8');
  assert.equal(presetAfterEdit({ ...form, realText: '96' }), 'arch:1/8');
  assert.equal(presetAfterEdit({ ...form, realText: '97' }), 'custom');
  assert.equal(formRatioText({ ...form, realText: '96' }), '1:96');
  assert.equal(formRatioText({ ...form, realText: '' }), '');
  const user = [{ id: 'user:a', user: true, label: '1 in = 7 ft', paperValue: 1, paperUnit: 'in', realValue: 7, realUnit: 'ft' }];
  assert.equal(choosePreset(form, 'user:a', user).realText, '7');
  assert.equal(choosePreset(form, 'user:a', user).realUnit, 'ft', 'a user preset keeps its own units');
});

test('pages: all, current, a validated custom range', () => {
  const form = initialSetScaleForm({});
  assert.deepEqual(setScalePages({ ...form, pagesMode: 'all' }, target), { pages: 'all' });
  assert.deepEqual(setScalePages(form, target), { pages: [2] });
  assert.deepEqual(setScalePages({ ...form, pagesMode: 'custom', rangeText: '2-4' }, target), { pages: [2, 3, 4] });
  assert.deepEqual(setScalePages({ ...form, pagesMode: 'custom', rangeText: '2-9' }, target), { error: 'range.outOfRange' });
  assert.deepEqual(setScalePages({ ...form, pagesMode: 'custom', rangeText: '' }, target), { error: 'range.empty' });
  assert.deepEqual(setScaleCommit({ ...form, pagesMode: 'custom', rangeText: 'x' }, target), { error: 'range.syntax' });
});

test('a detected architectural scale opens on its preset, a metric one in mm', async () => {
  const { initialSetScaleForm, formRatioText } = await import('./set-scale-form.js');
  const arch = initialSetScaleForm({ detectedRatio: 48, detectedImperial: true });
  assert.equal(arch.paperUnit, 'in');
  assert.equal(arch.realUnit, 'ft');
  assert.notEqual(arch.presetId, 'custom', '1/4" = 1\'-0" is a built-in preset');
  assert.equal(formRatioText(arch), '1:48', 'the shown equation is the detected scale, not 1/4 in = 4 ft');
  const metric = initialSetScaleForm({ detectedRatio: 50 });
  assert.equal(metric.paperUnit, 'mm');
  assert.equal(metric.presetId, 'metric:50');
});

test('reopening on a page at a fractional preset keeps its ratio', async () => {
  const { initialSetScaleForm, formRatioText } = await import('./set-scale-form.js');
  for (const [ppu, ratio] of [[ratioPixelsPerUnit(48, 'ft'), '1:48'], [ratioPixelsPerUnit(64, 'ft'), '1:64'], [ratioPixelsPerUnit(8, 'ft'), '1:8']]) {
    const form = initialSetScaleForm({}, { pixelsPerUnit: ppu, unit: 'ft', method: 'ratio' });
    assert.equal(formRatioText(form), ratio, `${form.paperText} ${form.paperUnit} = ${form.realText} ${form.realUnit}`);
  }
});
