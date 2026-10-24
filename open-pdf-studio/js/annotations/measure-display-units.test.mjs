import assert from 'node:assert/strict';
import test from 'node:test';
import { displayDenominator, displayText, otherSystemText } from './measure-precision.js';

test('a length shows in any unit, inches with fractions', () => {
  // 113.92" measured on a 1/8" = 1'-0" sheet (the NX 5x5 piece).
  const ft = 113.92 / 12;
  assert.equal(displayText(ft, 'ft', 'ft-in'), `9'-5 15/16"`);
  assert.equal(displayText(ft, 'ft', 'in'), '113 15/16"');
  assert.equal(displayText(ft, 'ft', 'ft'), '9.49 ft');
  assert.equal(displayText(ft, 'ft', 'mm'), '2894 mm');
  assert.equal(displayText(ft, 'ft', 'cm'), '289.4 cm');
  assert.equal(displayText(ft, 'ft', 'm'), '2.894 m');
  assert.equal(displayText(2894, 'mm', 'ft-in'), `9'-5 15/16"`);
  assert.equal(displayText(ft, 'ft', 'in', displayDenominator('fi32')), '113 29/32"');
});

test('areas follow the system, angles and page points do not convert', () => {
  assert.equal(displayText(100, 'ft²', 'm'), '9.29 m²');
  assert.equal(displayText(1, 'm²', 'ft-in'), '10.76 ft²');
  assert.equal(displayText(144, 'in²', 'in'), '144.00 in²');
  assert.equal(displayText(45, '°', 'mm'), null);
  assert.equal(displayText(10, 'pt', 'mm'), null);
  assert.equal(displayText(10, 'ft', 'auto'), null);
});

test('the other system goes beside the reading', () => {
  assert.equal(otherSystemText(9.5, 'ft', 'auto'), '2896 mm');
  assert.equal(otherSystemText(50, 'ft', 'auto'), '15.240 m');
  assert.equal(otherSystemText(2896, 'mm', 'auto'), `9'-6"`);
  assert.equal(otherSystemText(9.5, 'ft', 'mm'), `9'-6"`, 'shown in mm: the other system is imperial');
});
