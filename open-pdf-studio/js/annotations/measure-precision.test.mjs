import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatFraction, formatFeetInches, formatLengthWithPrecision, precisionOptions, precisionFromKey,
  parsePrecision, validPrecision, defaultPrecision,
} from './measure-precision.js';

test('feet-inches: 12.375 ft at 1/2" is 12\'-4 1/2"', () => {
  assert.equal(formatLengthWithPrecision(12.375, 'ft', 'fi2'), '12\'-4 1/2"');
  assert.equal(formatLengthWithPrecision(148.5, 'in', 'fi2'), '12\'-4 1/2"');
  assert.equal(formatFeetInches(286.5, 2), '23\'-10 1/2"');
  assert.equal(formatFeetInches(286.5, 1), '23\'-11"', 'whole inches round half up');
  assert.equal(formatFeetInches(0.2, 16), '0\'-0 3/16"');
  assert.equal(formatFeetInches(-30, 16), '-2\'-6"');
});

test('feet-inches rounding carries into the next inch and foot', () => {
  // 11'-11 31/32" at 1/16" rounds up to the next foot.
  assert.equal(formatFeetInches(11 * 12 + 11 + 31 / 32, 16), '12\'-0"');
  assert.equal(formatFeetInches(11 * 12 + 11 + 31 / 32, 32), '11\'-11 31/32"');
  assert.equal(formatFeetInches(5 * 12 + 3 + 63 / 64, 8), '5\'-4"');
  assert.equal(formatFeetInches(5 * 12 + 3 + 0.5, 16), '5\'-3 1/2"', 'fractions are reduced');
  assert.equal(formatFeetInches(12, 64), '1\'-0"');
});

test('inch fractions and decimals', () => {
  assert.equal(formatLengthWithPrecision(10.5, 'in', 'f16'), '10 1/2"');
  assert.equal(formatLengthWithPrecision(0.375, 'in', 'f8'), '3/8"');
  assert.equal(formatLengthWithPrecision(9.99, 'in', 'f4'), '10"');
  assert.equal(formatFraction(2.0625, 16), '2 1/16');
  assert.equal(formatLengthWithPrecision(12.3456, 'm', 3), '12.346 m');
  assert.equal(formatLengthWithPrecision(436.4, 'mm', 0), '436 mm');
  assert.equal(formatLengthWithPrecision(12.375, 'ft', 6), '12.375000 ft');
});

test('precision applies only where it can be shown', () => {
  assert.equal(formatLengthWithPrecision(3, 'mm', 'fi16'), null, 'no feet-inches in mm');
  assert.equal(formatLengthWithPrecision(3, 'ft', 'f16'), null, 'inch fractions only in inches');
  assert.equal(formatLengthWithPrecision(3, 'ft²', 2), null, 'areas keep their default');
  assert.equal(formatLengthWithPrecision(3, 'ft', undefined), null);
  assert.equal(formatLengthWithPrecision(3, 'ft', 7), null);
  assert.equal(formatLengthWithPrecision(3, 'ft', 'fi3'), null);
  assert.equal(validPrecision('fi1', 'in'), true);
  assert.equal(validPrecision('f1', 'in'), false);
  assert.deepEqual(parsePrecision('fi64', 'ft'), { kind: 'feetInches', denominator: 64 });
  assert.equal(defaultPrecision('mm'), 0);
  assert.equal(defaultPrecision('ft'), 'fi16', 'imperial defaults to feet-inches at 1/16"');
  assert.equal(defaultPrecision('in'), 'fi16');
  assert.equal(defaultPrecision('m'), 2);
});

test('dropdown options per unit', () => {
  const values = (unit) => precisionOptions(unit).map(o => o.value);
  assert.deepEqual(values('mm'), ['0', '1', '2', '3', '4', '5', '6']);
  assert.deepEqual(values('ft'), ['0', '1', '2', '3', '4', '5', '6',
    'fi1', 'fi2', 'fi4', 'fi8', 'fi16', 'fi32', 'fi64']);
  assert.deepEqual(values('in'), ['0', '1', '2', '3', '4', '5', '6',
    'f2', 'f4', 'f8', 'f16', 'f32', 'f64', 'fi1', 'fi2', 'fi4', 'fi8', 'fi16', 'fi32', 'fi64']);
  assert.deepEqual(precisionOptions('m').slice(0, 3).map(o => o.label), ['1', '0.1', '0.01']);
  assert.equal(precisionOptions('ft').find(o => o.value === 'fi2').label, '0\'-0 1/2"');
  for (const o of precisionOptions('in')) assert.equal(precisionFromKey(o.value), o.precision);
});
