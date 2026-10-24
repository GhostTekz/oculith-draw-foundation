// Set Scale presets and equations. The expected points-per-unit values are
// worked out by hand from 72 pt = 1 in on paper.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCALE_PRESET_GROUPS, builtInPreset, parseEquationLength, parseScaleEquation, equationPixelsPerUnit,
  equationRatio, equationText, equationFromText, scaleDataFromEquation, equationFromScale, presetEquation,
  matchingPreset, loadUserScalePresets, addUserScalePreset, deleteUserScalePreset, USER_SCALE_PRESETS_KEY,
  paperLengthFromPoints,
} from './scale-presets.js';
import { ratioPixelsPerUnit } from './scale-entry.js';

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected)), `${msg ?? ''} ${actual} != ${expected}`);

function memoryStorage() {
  const values = new Map();
  return { values, getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)) };
}

test('the built-in preset lists', () => {
  const labels = Object.fromEntries(SCALE_PRESET_GROUPS.map(g => [g.group, g.presets.map(p => p.label)]));
  assert.deepEqual(labels.architectural, ['1/32" = 1\'-0"', '1/16" = 1\'-0"', '3/32" = 1\'-0"', '1/8" = 1\'-0"',
    '3/16" = 1\'-0"', '1/4" = 1\'-0"', '3/8" = 1\'-0"', '1/2" = 1\'-0"', '3/4" = 1\'-0"', '1" = 1\'-0"',
    '1-1/2" = 1\'-0"', '3" = 1\'-0"']);
  assert.deepEqual(labels.engineering, ['1" = 10\'', '1" = 20\'', '1" = 30\'', '1" = 40\'', '1" = 50\'',
    '1" = 60\'', '1" = 100\'', '1" = 200\'']);
  assert.deepEqual(labels.metric, ['1:1', '1:2', '1:5', '1:10', '1:20', '1:25', '1:50', '1:100', '1:200',
    '1:250', '1:500', '1:1000']);
});

test('preset to points per unit: 1/4" = 1\'-0" is 18 pt/ft, 1" = 20\' is 3.6 pt/ft, 1:100 in mm', () => {
  near(equationPixelsPerUnit(builtInPreset('arch:1/4')), 18);
  near(equationRatio(builtInPreset('arch:1/4')), 48);
  near(equationPixelsPerUnit(builtInPreset('arch:1-1/2')), 108);
  near(equationPixelsPerUnit(builtInPreset('eng:20')), 3.6);
  near(equationRatio(builtInPreset('eng:20')), 240);
  // 1 mm paper = 72/25.4 pt for 100 mm real.
  near(equationPixelsPerUnit(builtInPreset('metric:100')), 72 / 25.4 / 100);
  near(equationPixelsPerUnit(builtInPreset('metric:100')), ratioPixelsPerUnit(100, 'mm'));
  // Every metric preset agrees with the 1:N ratio rule.
  for (const p of SCALE_PRESET_GROUPS[2].presets) near(equationPixelsPerUnit(p), ratioPixelsPerUnit(p.realValue, 'mm'), p.label);
});

test('a metric preset in m and an imperial preset in inches stay the same scale', () => {
  const m = presetEquation(builtInPreset('metric:100'), 'm');
  assert.deepEqual([m.paperText, m.paperUnit, m.realText, m.realUnit], ['1', 'mm', '0.1', 'm']);
  near(equationPixelsPerUnit(m), ratioPixelsPerUnit(100, 'm'));
  const inch = presetEquation(builtInPreset('arch:1/4'), 'in');
  assert.deepEqual([inch.paperText, inch.realText, inch.realUnit], ['1/4', '12', 'in']);
  near(equationPixelsPerUnit(inch), 1.5);
  // A unit of the other system keeps the preset's own real unit.
  assert.equal(presetEquation(builtInPreset('metric:50'), 'ft').realUnit, 'mm');
});

test('equation lengths: decimals, fractions, feet-inches on ft fields, other units converted', () => {
  assert.equal(parseEquationLength('1/4', 'in'), 0.25);
  assert.equal(parseEquationLength('1 1/2', 'in'), 1.5);
  assert.equal(parseEquationLength('1-1/2', 'in'), 1.5);
  assert.equal(parseEquationLength('0,5', 'mm'), 0.5);
  assert.equal(parseEquationLength('.25', 'in'), 0.25);
  assert.equal(parseEquationLength('10\'-6"', 'ft'), 10.5);
  assert.equal(parseEquationLength('6"', 'ft'), 0.5);
  assert.equal(parseEquationLength('1\'-0"', 'in'), 12);
  near(parseEquationLength('5 cm', 'mm'), 50);
  near(parseEquationLength('1 ft', 'm'), 0.3048);
  for (const bad of ['', '0', '-2', 'abc', '1/0', '1:100']) assert.equal(parseEquationLength(bad, 'ft'), null, bad);
  assert.equal(parseEquationLength('1', 'yd'), null);
});

test('mixed-unit equations: 1 in = 8 ft, 1 mm = 0.1 m, 3 in = 1\'-0"', () => {
  const a = parseScaleEquation('1', 'in', '8', 'ft');
  near(equationPixelsPerUnit(a), 9);
  near(equationRatio(a), 96);
  assert.equal(equationText(a), '1 in = 8 ft');
  const b = parseScaleEquation('1', 'mm', '0.1', 'm');
  near(equationPixelsPerUnit(b), ratioPixelsPerUnit(100, 'm'));
  near(equationRatio(b), 100);
  const c = parseScaleEquation('3', 'in', '1\'-0"', 'ft');
  near(equationRatio(c), 4);
  // Metric paper against imperial real: 1 mm = 1 ft is 1:304.8.
  near(equationRatio(parseScaleEquation('1', 'mm', '1', 'ft')), 304.8);
  assert.equal(parseScaleEquation('1', 'in', '', 'ft'), null);
  assert.equal(parseScaleEquation('0', 'in', '8', 'ft'), null);
});

test('scale data from an equation and the equation back from a scale', () => {
  const eq = parseScaleEquation('1/4', 'in', '1', 'ft');
  const data = scaleDataFromEquation(eq, { precision: 'fi16' });
  near(data.pixelsPerUnit, 18);
  assert.equal(data.unit, 'ft');
  assert.equal(data.scaleRatio, '1:48');
  assert.equal(data.method, 'ratio');
  assert.equal(data.precision, 'fi16');
  assert.deepEqual(equationFromScale(data), eq);
  // A scale without its equation: one inch (imperial) or mm (metric) on paper.
  const derived = equationFromScale({ pixelsPerUnit: 18, unit: 'ft' });
  assert.deepEqual([derived.paperValue, derived.paperUnit, derived.realValue, derived.realUnit], [1, 'in', 4, 'ft']);
  const metric = equationFromScale({ pixelsPerUnit: ratioPixelsPerUnit(50, 'm'), unit: 'm' });
  assert.equal(metric.paperUnit, 'mm');
  near(metric.realValue, 0.05);
  // From a saved PDF the /R text carries the equation.
  assert.deepEqual(equationFromScale({ pixelsPerUnit: 18, unit: 'ft', scaleRatio: '0.25 in = 1 ft' }),
    { paperValue: 0.25, paperUnit: 'in', realValue: 1, realUnit: 'ft' });
  assert.equal(equationFromText('1:48'), null);
  // A stale equation that does not give the scale is ignored.
  assert.equal(equationFromScale({ pixelsPerUnit: 9, unit: 'ft', equation: eq }).realValue, 8);
  assert.equal(equationFromScale({ pixelsPerUnit: 1, unit: 'pt' }), null);
});

test('matching a preset', () => {
  assert.equal(matchingPreset(parseScaleEquation('1/4', 'in', '1', 'ft')).id, 'arch:1/4');
  assert.equal(matchingPreset(parseScaleEquation('0.25', 'in', '12', 'in')).id, 'arch:1/4');
  assert.equal(matchingPreset(parseScaleEquation('1', 'in', '20', 'ft')).id, 'eng:20');
  assert.equal(matchingPreset(parseScaleEquation('1', 'mm', '0.1', 'm')).id, 'metric:100');
  assert.equal(matchingPreset(parseScaleEquation('1', 'in', '8', 'ft')).id, 'arch:1/8');
  assert.equal(matchingPreset(parseScaleEquation('1', 'in', '7', 'ft')), null);
  assert.equal(matchingPreset(parseScaleEquation('1', 'cm', '1', 'm')), null, 'paper in cm is custom');
});

test('user presets persist locally, newest first, without duplicates; only they can be deleted', async () => {
  const storage = memoryStorage();
  assert.deepEqual(loadUserScalePresets(storage), []);
  const first = addUserScalePreset(parseScaleEquation('1', 'in', '7', 'ft'), storage);
  assert.equal(first.presets.length, 1);
  assert.equal(first.preset.label, '1 in = 7 ft');
  assert.ok(first.preset.user);
  const second = addUserScalePreset(parseScaleEquation('1', 'mm', '0.075', 'm'), storage);
  assert.deepEqual(second.presets.map(p => p.label), ['1 mm = 0.075 m', '1 in = 7 ft']);
  const again = addUserScalePreset(parseScaleEquation('1', 'in', '7', 'ft'), storage);
  assert.equal(again.preset.id, first.preset.id, 'the same equation is not stored twice');
  assert.deepEqual(again.presets.map(p => p.label), ['1 in = 7 ft', '1 mm = 0.075 m']);
  // A reload (new module instance) reads the same list back.
  const reloaded = await import(`./scale-presets.js?reload=${Date.now()}`);
  const list = reloaded.loadUserScalePresets(storage);
  assert.deepEqual(list.map(p => p.label), ['1 in = 7 ft', '1 mm = 0.075 m']);
  near(equationPixelsPerUnit(list[0]), 72 / 7);
  assert.equal(matchingPreset(parseScaleEquation('1', 'in', '7', 'ft'), list).id, first.preset.id);
  // Built-in ids are not in the user list, so deleting one changes nothing.
  assert.equal(deleteUserScalePreset('metric:100', storage).length, 2);
  assert.deepEqual(deleteUserScalePreset(first.preset.id, storage).map(p => p.label), ['1 mm = 0.075 m']);
  assert.equal(loadUserScalePresets(storage).length, 1);
  assert.equal(addUserScalePreset(null, storage).preset, null);
});

test('user preset storage is validated', () => {
  const storage = memoryStorage();
  storage.setItem(USER_SCALE_PRESETS_KEY, '{broken');
  assert.deepEqual(loadUserScalePresets(storage), []);
  storage.setItem(USER_SCALE_PRESETS_KEY, JSON.stringify([
    { id: 'user:ok', paperValue: 1, paperUnit: 'in', realValue: 4, realUnit: 'ft' },
    { id: 'user:bad-unit', paperValue: 1, paperUnit: 'in', realValue: 4, realUnit: 'yd' },
    { id: 'arch:1/4', paperValue: 1, paperUnit: 'in', realValue: 4, realUnit: 'ft' },
    { id: 'user:zero', paperValue: 0, paperUnit: 'in', realValue: 4, realUnit: 'ft' },
  ]));
  assert.deepEqual(loadUserScalePresets(storage).map(p => p.id), ['user:ok']);
  assert.deepEqual(loadUserScalePresets(undefined), []);
});

test('a picked distance in PDF points as paper length', () => {
  assert.equal(paperLengthFromPoints(72, 'in'), 1);
  near(paperLengthFromPoints(36, 'mm'), 12.7);
  assert.equal(paperLengthFromPoints(0, 'in'), null);
});
