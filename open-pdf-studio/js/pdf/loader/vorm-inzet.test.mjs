import test from 'node:test';
import assert from 'node:assert/strict';
import { vormInzet, pasVormInzetToe } from './vorm-inzet.js';

const dicht = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('externe cirkel: /RD w/2 rondom, pad op w binnen /Rect (straal 1,13 bij /Rect 4,26 en w 1)', () => {
  const inzet = vormInzet({ rd: [0.5, 0.5, 0.5, 0.5], lijndikte: 1 });
  const v = pasVormInzetToe({ x: 10, y: 20, width: 4.26, height: 4.26 }, inzet, 1);
  dicht(v.width / 2, 1.13);
  dicht(v.x, 11);
  dicht(v.y, 21);
});

test('schaal: inzet in PDF-eenheden, vak in weergave-eenheden', () => {
  const inzet = vormInzet({ rd: [2.5, 2.5, 2.5, 2.5], lijndikte: 5 });
  const v = pasVormInzetToe({ x: 0, y: 0, width: 200, height: 100 }, inzet, 2);
  dicht(v.x, 10); dicht(v.width, 180); dicht(v.height, 80);
});

test('ongelijke /RD: boven en onder in de juiste richting (y naar beneden)', () => {
  const inzet = vormInzet({ rd: [1, 2, 3, 4], lijndikte: 0 });
  const v = pasVormInzetToe({ x: 0, y: 0, width: 100, height: 100 }, inzet, 1);
  dicht(v.x, 1); dicht(v.y, 4); dicht(v.width, 96); dicht(v.height, 94);
});

test('gedraaid: gemiddelde inzet rondom', () => {
  const inzet = vormInzet({ rd: [1, 2, 3, 4], lijndikte: 0 });
  const v = pasVormInzetToe({ x: 0, y: 0, width: 100, height: 100 }, inzet, 1, true);
  dicht(v.x, 2.5); dicht(v.y, 2.5); dicht(v.width, 95);
});

test('zonder /RD, met wolkrand of met onzinnige /RD: geen inzet', () => {
  assert.equal(vormInzet({ rd: null, lijndikte: 1 }), null);
  assert.equal(vormInzet({ rd: [0.5, 0.5, 0.5, 0.5], lijndikte: 1, wolk: true }), null);
  assert.equal(vormInzet({ rd: [-1, 0, 0, 0], lijndikte: 1 }), null);
  assert.equal(vormInzet({ rd: [0, 0, 0], lijndikte: 1 }), null);
});

test('standaardlijndikte 1 als /BS ontbreekt', () => {
  const inzet = vormInzet({ rd: [0.5, 0.5, 0.5, 0.5] });
  dicht(inzet.links, 1);
});

test('een inzet die niets overlaat wordt niet toegepast', () => {
  const vak = { x: 0, y: 0, width: 1, height: 1 };
  assert.deepEqual(pasVormInzetToe(vak, vormInzet({ rd: [1, 1, 1, 1], lijndikte: 1 }), 1), vak);
});
