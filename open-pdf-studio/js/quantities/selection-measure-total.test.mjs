// Σ of the selected measurements in the Properties toolbar: two or more of
// one kind in one known unit; mixed units, mixed kinds, angles and legacy
// measurements without a unit give no total.

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionMeasureTotal, measurementKind } from './measurement-summary.js';

const dist = (value, unit = 'mm') => ({ type: 'measureDistance', measureValue: value, measureUnit: unit });
const perim = (value, unit = 'mm') => ({ type: 'measurePerimeter', measureValue: value, measureUnit: unit });
const area = (value, unit = 'mm²') => ({ type: 'measureArea', measureValue: value, measureUnit: unit });

test('kind follows the measurement: squared unit = area, angle never summed', () => {
  assert.equal(measurementKind(dist(1)), 'length');
  assert.equal(measurementKind(perim(1, 'ft')), 'length');
  assert.equal(measurementKind(area(1)), 'area');
  assert.equal(measurementKind({ type: 'measureAngle', measureValue: 30 }), 'angle');
  assert.equal(measurementKind({ type: 'line' }), null);
  assert.equal(measurementKind({ type: 'measureDistance' }), null, 'no value');
});

test('lengths in one unit add up, other selected markups are ignored', () => {
  const total = selectionMeasureTotal([dist(1200), perim(800), { type: 'box' }]);
  assert.deepEqual(total, { kind: 'length', count: 2, value: 2000, unit: 'mm', calibrated: true });
});

test('areas in one unit add up', () => {
  const total = selectionMeasureTotal([area(2, 'ft²'), area(3.5, 'ft²')]);
  assert.equal(total.kind, 'area');
  assert.equal(total.value, 5.5);
  assert.equal(total.unit, 'ft²');
});

test('no total: one measurement, mixed units, mixed kinds, angles, missing unit', () => {
  assert.equal(selectionMeasureTotal([dist(5)]), null);
  assert.equal(selectionMeasureTotal([dist(5), { type: 'line' }]), null);
  assert.equal(selectionMeasureTotal([dist(5, 'mm'), dist(1, 'ft')]), null);
  assert.equal(selectionMeasureTotal([dist(5), area(5)]), null);
  assert.equal(selectionMeasureTotal([{ type: 'measureAngle', measureValue: 30 }, { type: 'measureAngle', measureValue: 60 }]), null);
  assert.equal(selectionMeasureTotal([dist(5, ''), dist(6, '')]), null);
  assert.equal(selectionMeasureTotal(null), null);
});

test('uncalibrated measurements (page points) total as uncalibrated', () => {
  const total = selectionMeasureTotal([dist(72, 'pt'), dist(36, 'pt')]);
  assert.equal(total.value, 108);
  assert.equal(total.calibrated, false);
  assert.equal(selectionMeasureTotal([area(10, 'pt²'), area(5, 'pt²')]).calibrated, false);
  // Calibrated and uncalibrated never mix.
  assert.equal(selectionMeasureTotal([dist(72, 'pt'), dist(25.4, 'mm')]), null);
});
