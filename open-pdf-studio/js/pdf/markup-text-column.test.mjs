import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { customTextColumnName, customTextValue } from '../annotations/custom-text-column.js';
import { markupTextColumnForSave, readMarkupTextColumn, saveMarkupTextColumn,
  readMarkupSecondTextColumn, secondTextColumnForSave, saveMarkupSecondTextColumn } from './markup-text-column.js';

test('custom text schema rejects controls, oversized strings and fixed headings', () => {
  assert.equal(customTextColumnName('  Review phase  '), 'Review phase');
  for (const bad of ['Status', 'text', 'A\nB', 'X'.repeat(49), '', 42]) assert.equal(customTextColumnName(bad), '');
  assert.equal(customTextValue('=SUM(1,2)'), '=SUM(1,2)');
  for (const bad of ['A\nB', 'X'.repeat(257), null]) assert.equal(customTextValue(bad), '');
});

test('second Text catalog is independent and rejects duplicate or oversized names', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupTextColumn(pdf, 'Review phase');
  assert.equal(readMarkupSecondTextColumn(pdf), '', 'old PDFs have no second Text column');
  saveMarkupSecondTextColumn(pdf, 'Inspector note');
  assert.equal(secondTextColumnForSave({ markupTextColumn2Name: '' }, pdf,
    ['Review phase']), 'Inspector note');
  assert.throws(() => secondTextColumnForSave({ markupTextColumn2Name: 'REVIEW PHASE' }, pdf,
    ['Review phase']), /different names/u);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.equal(readMarkupTextColumn(pdf), 'Review phase');
    assert.equal(readMarkupSecondTextColumn(pdf), 'Inspector note');
    saveMarkupSecondTextColumn(pdf, readMarkupSecondTextColumn(pdf));
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  catalog.set(PDFName.of('OPS_MarkupTextColumn2V1'), PDFHexString.fromText('X'.repeat(1000)));
  assert.equal(readMarkupSecondTextColumn(pdf), '');
});

test('column name survives two real PDF save/reopen cycles and invalid catalog data is ignored', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupTextColumn(pdf, 'Review phase');
  assert.equal(markupTextColumnForSave({ markupTextColumnName: '' }, pdf), 'Review phase',
    'an unfinished asynchronous catalog read cannot erase the source column on save');
  assert.equal(markupTextColumnForSave({ markupTextColumnName: 'Renamed phase' }, pdf), 'Renamed phase',
    'an explicit user rename wins over source metadata');
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.equal(readMarkupTextColumn(pdf), 'Review phase');
    saveMarkupTextColumn(pdf, readMarkupTextColumn(pdf));
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  catalog.set(PDFName.of('OPS_MarkupTextColumn'), PDFHexString.fromText('X'.repeat(1000)));
  assert.equal(readMarkupTextColumn(pdf), '');
  saveMarkupTextColumn(pdf, '');
  assert.equal(catalog.get(PDFName.of('OPS_MarkupTextColumn')), undefined);
});
