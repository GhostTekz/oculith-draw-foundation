import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName, degrees } from 'pdf-lib';
import { formulaColumn, formulaNumberSourceValue, formulaScaledValue, formulaText, formulaValue } from '../annotations/custom-formula-column.js';
import { saveMarkupNumberColumn } from './markup-number-column.js';
import { saveMarkupSecondNumberColumn } from './markup-second-number-column.js';
import { saveMarkupChoiceColumn } from './markup-choice-column.js';
import { ensureMarkupColumnsReady } from './markup-columns.js';
import { markupFormulaColumnForSave, readMarkupFormulaColumn, saveMarkupFormulaColumn } from './markup-formula-column.js';

const number = { version: 1, name: 'Quantity' };
const formula = { version: 1, name: 'Estimate', source: 'customNumber', multiplier: '12.5', offset: '2' };
const choice = { version: 2, name: 'Rate', options: ['Standard', 'Premium', 'Unpriced'],
  numericValues: ['12.5', '-0.893054', null] };
const choiceFormula = { version: 2, name: 'Adjusted rate', source: 'customChoice',
  multiplier: '2', offset: '0.199466' };

test('Formula accepts one bounded Number affine expression and blanks invalid or missing values', () => {
  assert.deepEqual(formulaColumn(formula, number, 'Review'), formula);
  assert.equal(formulaValue('-7.25', formula), -88.625);
  assert.equal(formulaText('0', formula), '2');
  assert.equal(formulaText(null, formula), '');
  assert.equal(formulaText('1e3', formula), '');
  assert.equal(formulaValue('999999999', formula), null);
  assert.equal(formulaText('-620399897.661694', {
    source: 'customNumber', multiplier: '-0.893054', offset: '0.199466',
  }), '554050610.405832');
  assert.equal(formulaScaledValue('-620399897.661694', {
    source: 'customNumber', multiplier: '-0.893054', offset: '0.199466',
  }), 554050610405832n);
  assert.equal(formulaText('0.000001', {
    source: 'customNumber', multiplier: '0.5', offset: '0',
  }), '0.000001');
  assert.equal(formulaText('-0.000001', {
    source: 'customNumber', multiplier: '0.5', offset: '0',
  }), '-0.000001');
  for (const invalid of [{ ...formula, version: 2 }, { ...formula, source: 'measureArea' },
    { ...formula, multiplier: '1e3' }, { ...formula, offset: '1.0' },
    { ...formula, extra: 'x' }, { ...formula, name: 'Quantity' },
    { ...formula, name: 'Review' }]) {
    assert.equal(formulaColumn(invalid, number, 'Review'), null);
  }
  assert.equal(formulaColumn(formula, null), null);
});

test('Formula catalog and Number source survive two rotated CropBox PDF saves and early hydration', async () => {
  let pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.setCropBox(36, 40, 540, 720);
  page.setRotation(degrees(90));
  saveMarkupNumberColumn(pdf, number);
  saveMarkupFormulaColumn(pdf, formula);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(pdf.getPage(0).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(0).getRotation().angle, 90);
    assert.deepEqual(readMarkupFormulaColumn(pdf), formula);
    const doc = { markupNumberColumn: null, markupFormulaColumn: null,
      _sharedPdfLibDocPromise: Promise.resolve(pdf) };
    await ensureMarkupColumnsReady(doc);
    assert.deepEqual(doc.markupFormulaColumn, formula);
    const saved = markupFormulaColumnForSave({ markupFormulaColumn: null }, pdf, '', null, number, null);
    assert.deepEqual(saved, formula);
    saveMarkupFormulaColumn(pdf, saved);
  }
  const key = PDFName.of('OPS_MarkupFormulaColumnV1');
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  catalog.set(PDFName.of('OPS_MarkupFormulaColumnV2'), PDFHexString.fromText('{broken'));
  assert.deepEqual(readMarkupFormulaColumn(pdf), formula,
    'malformed Choice Formula metadata must not hide a valid Number Formula');
  catalog.set(key, PDFHexString.fromText(JSON.stringify({ ...formula, multiplier: '1e6' })));
  assert.equal(readMarkupFormulaColumn(pdf), null);
  catalog.set(key, PDFHexString.fromText('x'.repeat(2000)));
  assert.equal(readMarkupFormulaColumn(pdf), null);
});

test('Choice-sourced Formula uses mapped decimals, blanks unmapped options, and saves twice', async () => {
  assert.deepEqual(formulaColumn(choiceFormula, null, '', choice.name, '', choice), choiceFormula);
  assert.equal(formulaColumn(choiceFormula, null, '', choice.name, '', { ...choice, version: 1 }), null);
  assert.equal(formulaText(null, choiceFormula, 'Standard', choice), '25.199466');
  assert.equal(formulaText(null, choiceFormula, 'Unpriced', choice), '');
  assert.equal(formulaText(null, choiceFormula, 'Unknown', choice), '');
  let pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.setCropBox(36, 40, 540, 720);
  page.setRotation(degrees(90));
  saveMarkupChoiceColumn(pdf, choice);
  saveMarkupFormulaColumn(pdf, choiceFormula);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.equal(pdf.getPage(0).getRotation().angle, 90);
    assert.deepEqual(pdf.getPage(0).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.deepEqual(readMarkupFormulaColumn(pdf), choiceFormula);
    assert.equal(pdf.catalog.get(PDFName.of('OPS_MarkupFormulaColumnV1')), undefined);
    const doc = { markupChoiceColumn: null, markupFormulaColumn: null,
      _sharedPdfLibDocPromise: Promise.resolve(pdf) };
    await ensureMarkupColumnsReady(doc);
    assert.deepEqual(doc.markupChoiceColumn, choice);
    assert.deepEqual(doc.markupFormulaColumn, choiceFormula);
    const saved = markupFormulaColumnForSave({ markupFormulaColumn: null }, pdf,
      '', choice, null, null);
    saveMarkupFormulaColumn(pdf, saved);
  }
});

test('version 3 Formula selects second Number and keeps older catalog formats compatible', async () => {
  const secondNumber = { version: 1, name: 'Unit cost' };
  const secondFormula = { version: 3, name: 'Extended cost', source: 'customNumber2',
    multiplier: '-0.893054', offset: '0.199466' };
  assert.deepEqual(formulaColumn(secondFormula, number, '', '', '', null, secondNumber), secondFormula);
  assert.equal(formulaColumn(secondFormula, number), null);
  assert.equal(formulaColumn({ ...secondFormula, version: 1 }, number, '', '', '', null, secondNumber), null);
  assert.equal(formulaColumn({ ...secondFormula, source: 'customNumber' }, number, '', '', '', null, secondNumber), null);
  assert.equal(formulaColumn({ ...secondFormula, name: secondNumber.name }, number, '', '', '', null, secondNumber), null);
  const annotation = { markupNumberValue: 7, markupNumberValue2: '-620399897.661694' };
  assert.equal(formulaNumberSourceValue(annotation, secondFormula), annotation.markupNumberValue2);
  assert.equal(formulaText(formulaNumberSourceValue(annotation, secondFormula), secondFormula),
    '554050610.405832');

  let pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.setCropBox(36, 40, 540, 720);
  page.setRotation(degrees(90));
  saveMarkupNumberColumn(pdf, number);
  saveMarkupSecondNumberColumn(pdf, secondNumber);
  saveMarkupFormulaColumn(pdf, secondFormula);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(pdf.getPage(0).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(0).getRotation().angle, 90);
    assert.deepEqual(readMarkupFormulaColumn(pdf), secondFormula);
    assert.equal(pdf.catalog.get(PDFName.of('OPS_MarkupFormulaColumnV1')), undefined);
    assert.equal(pdf.catalog.get(PDFName.of('OPS_MarkupFormulaColumnV2')), undefined);
    const doc = { markupFormulaColumn: null, _sharedPdfLibDocPromise: Promise.resolve(pdf) };
    await ensureMarkupColumnsReady(doc);
    assert.deepEqual(doc.markupNumberColumn2, secondNumber);
    assert.deepEqual(doc.markupFormulaColumn, secondFormula);
    const saved = markupFormulaColumnForSave({ markupFormulaColumn: null }, pdf,
      '', null, number, null);
    saveMarkupFormulaColumn(pdf, saved);
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  catalog.set(PDFName.of('OPS_MarkupFormulaColumnV3'), PDFHexString.fromText('{broken'));
  assert.equal(readMarkupFormulaColumn(pdf), null);
  saveMarkupFormulaColumn(pdf, formula);
  assert.deepEqual(readMarkupFormulaColumn(pdf), formula);
  assert.equal(catalog.get(PDFName.of('OPS_MarkupFormulaColumnV3')), undefined);
});
