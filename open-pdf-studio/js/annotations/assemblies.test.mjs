import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  assembliesCsv, assembliesModel, bidLines, evaluateAssembly, normalizeRecipe,
} from './assemblies.js';
import { readAssemblies, saveAssemblies, ASSEMBLIES_KEY } from '../pdf/assemblies-pdf.js';

const recipe = {
  id: 'asm_box',
  name: 'Box',
  lines: [
    { name: 'Device', qty: 2, unit: 'each', unitPrice: 1.5 },
    { name: 'Wire', qty: 3, unit: 'length', unitPrice: 0.4 },
  ],
};

test('each-lines multiply by the count, and a missing count is 1', () => {
  const counted = evaluateAssembly({ type: 'count', count: 4 }, recipe);
  assert.equal(counted.lines[0].quantity, 8);
  assert.equal(counted.lines[0].extended, 12);
  const once = evaluateAssembly({ type: 'count' }, recipe);
  assert.equal(once.lines[0].quantity, 2);
  assert.equal(once.lines[0].unit, 'each');
});

test('length-lines multiply by the calibrated length in that unit', () => {
  const priced = evaluateAssembly({
    type: 'measureDistance', measureValue: 10, measureUnit: 'ft', measureCalibrated: true,
  }, recipe);
  const wire = priced.lines.find((line) => line.name === 'Wire');
  assert.equal(wire.quantity, 30);
  assert.equal(wire.unit, 'ft');
  assert.equal(wire.extended, 12);
  assert.equal(priced.scaleNotSet, false);
  assert.equal(priced.lines.find((line) => line.name === 'Device').quantity, 2);
});

test('an uncalibrated length is omitted and flagged, and page points are not a length', () => {
  for (const markup of [
    { type: 'measureDistance', measureValue: 10, measureUnit: 'ft', measureCalibrated: false },
    { type: 'measurePerimeter', measureValue: 10, measureUnit: 'pt' },
    { type: 'count', count: 2 },
  ]) {
    const priced = evaluateAssembly(markup, recipe);
    assert.equal(priced.lines.some((line) => line.name === 'Wire'), false, markup.type);
    assert.equal(priced.scaleNotSet, true);
    assert.equal(priced.lines[0].name, 'Device');
  }
});

test('a blank calibrated length does not count as scale not set', () => {
  const priced = evaluateAssembly({
    type: 'measureDistance', measureValue: '', measureUnit: 'ft',
  }, recipe);
  assert.equal(priced.lines.some((line) => line.name === 'Wire'), false);
  assert.equal(priced.scaleNotSet, false);
});

test('the price is the typed unit price, not another number on the markup', () => {
  const priced = evaluateAssembly({
    type: 'count', count: 1, markupNumberValue: 99, measureValue: 99,
  }, { id: 'asm_one', name: 'One', lines: [{ name: 'Cover', qty: 1, unit: 'each', unitPrice: 4 }] });
  assert.equal(priced.lines[0].unitPrice, 4);
  assert.equal(priced.lines[0].extended, 4);
});

test('normalize keeps a usable recipe and drops a blank or bad line', () => {
  const kept = normalizeRecipe({
    id: 'asm_ok', name: '  Ok  ',
    lines: [
      { name: 'Good', qty: 1, unit: 'each', unitPrice: 0 },
      { name: '', qty: 1, unit: 'each', unitPrice: 1 },
      { name: 'Bad', qty: 0, unit: 'each', unitPrice: 1 },
      { name: 'Nope', qty: 1, unit: 'area', unitPrice: 1 },
    ],
  });
  assert.deepEqual(kept.lines, [{ name: 'Good', qty: 1, unit: 'each', unitPrice: 0 }]);
  assert.equal(normalizeRecipe({ id: 'asm_no', name: 'No', lines: [] }), null);
  assert.equal(assembliesModel({ recipes: [kept, kept] }).recipes.length, 1);
});

test('the CSV lists each priced part and one scale-not-set row', () => {
  const doc = {
    assemblies: { v: 1, recipes: [recipe] },
    annotations: [
      { id: 'c1', type: 'count', count: 3, assemblyId: 'asm_box' },
      { id: 'm1', type: 'measureDistance', measureValue: 10, measureUnit: 'pt', assemblyId: 'asm_box' },
      { id: 'other', type: 'count', count: 9 },
    ],
  };
  const rows = bidLines(doc);
  assert.equal(rows.filter((row) => row.markupId === 'c1' && !row.scaleNotSet).length, 1);
  assert.equal(rows.find((row) => row.markupId === 'c1' && row.scaleNotSet).part, '');
  assert.equal(rows.some((row) => row.markupId === 'other'), false);
  const csv = assembliesCsv(doc);
  assert.ok(csv.startsWith('assembly,part,quantity,unit,unitPrice,extended,markupId,scaleNotSet\n'));
  assert.match(csv, /Box,Device,6,each,1\.5,9,c1,/u);
  assert.match(csv, /Box,,,,,,m1,yes/u);
});

test('the catalog key round-trips and an empty model is removed', async () => {
  const pdf = await PDFDocument.create();
  saveAssemblies(pdf, { v: 1, recipes: [recipe] });
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  assert.ok(catalog.get(PDFName.of(ASSEMBLIES_KEY)));
  const read = readAssemblies(pdf);
  assert.equal(read.recipes[0].name, 'Box');
  assert.equal(read.recipes[0].lines.length, 2);
  saveAssemblies(pdf, { v: 1, recipes: [] });
  assert.equal(readAssemblies(pdf), null);
});
