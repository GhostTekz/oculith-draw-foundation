import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { numberColumn, numberText, numberValue } from '../annotations/custom-number-column.js';
import { saveMarkupTextColumn } from './markup-text-column.js';
import { saveMarkupChoiceColumn } from './markup-choice-column.js';
import { ensureMarkupColumnsReady } from './markup-columns.js';
import { markupNumberColumnForSave, readMarkupNumberColumn,
  saveMarkupNumberColumn } from './markup-number-column.js';
import { extractAnnotationColors } from './loader/color-extraction.js';

const DEFINITION = { version: 1, name: 'Quantity' };
const CHOICE = { version: 1, name: 'Disposition', options: ['Review', 'Approved'] };

test('Number column and values accept only bounded canonical finite decimals', () => {
  assert.deepEqual(numberColumn(DEFINITION, 'Reviewer note', 'Disposition'), DEFINITION);
  assert.equal(numberColumn(DEFINITION, 'Quantity'), null);
  assert.equal(numberColumn(DEFINITION, '', 'quantity'), null);
  for (const invalid of [{ ...DEFINITION, version: 2 }, { ...DEFINITION, extra: 'x' },
    { ...DEFINITION, name: 'Status' }, { ...DEFINITION, name: 'A\nB' }]) {
    assert.equal(numberColumn(invalid), null);
  }
  for (const [input, expected] of [['0', 0], ['-0', 0], [-0, 0],
    ['999999999.999999', 999999999.999999], ['-7.25', -7.25], ['0.000001', 0.000001]]) {
    assert.equal(numberValue(input), expected);
  }
  assert.equal(numberText('-0'), '0');
  for (const invalid of ['1e3', '-1E-2', 'Infinity', 'NaN', '1,000', '01', '.5',
    '0.0000001', '1000000000', '-9999999999', '1.2345678', '', Infinity, NaN, null]) {
    assert.equal(numberValue(invalid), null, String(invalid));
  }
});

test('Number catalog survives two real PDF saves and early hydration with Text and Choice', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupTextColumn(pdf, 'Reviewer note');
  saveMarkupChoiceColumn(pdf, CHOICE);
  saveMarkupNumberColumn(pdf, DEFINITION);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(readMarkupNumberColumn(pdf), DEFINITION);
    const doc = { markupTextColumnName: '', markupChoiceColumn: null,
      markupNumberColumn: null, _sharedPdfLibDocPromise: Promise.resolve(pdf) };
    await ensureMarkupColumnsReady(doc);
    assert.equal(doc.markupTextColumnName, 'Reviewer note');
    assert.deepEqual(doc.markupChoiceColumn, CHOICE);
    assert.deepEqual(doc.markupNumberColumn, DEFINITION);
    assert.deepEqual(markupNumberColumnForSave(doc, pdf, doc.markupTextColumnName,
      doc.markupChoiceColumn), DEFINITION);
    saveMarkupNumberColumn(pdf, doc.markupNumberColumn);
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  const key = PDFName.of('OPS_MarkupNumberColumnV1');
  const original = catalog.lookup(key).decodeText();
  assert.throws(() => markupNumberColumnForSave({ markupTextColumnName: 'Quantity',
    markupNumberColumn: null }, pdf, 'Quantity', CHOICE), /different names/u);
  assert.throws(() => markupNumberColumnForSave({ markupChoiceColumn: { ...CHOICE, name: 'Quantity' },
    markupNumberColumn: null }, pdf, 'Reviewer note', { ...CHOICE, name: 'Quantity' }), /different names/u);
  assert.equal(catalog.lookup(key).decodeText(), original);
  for (const invalid of [PDFHexString.fromText('{broken'),
    PDFHexString.fromText('X'.repeat(2000)), PDFHexString.fromText(JSON.stringify({ ...DEFINITION, version: 2 }))]) {
    catalog.set(key, invalid);
    assert.equal(readMarkupNumberColumn(pdf), null);
  }
});

test('co-located Number values use PDF references; invalid and oversized strings are ignored', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const context = pdf.context;
  const annotation = value => context.register(context.obj({ Type: 'Annot', Subtype: 'Square',
    Rect: [20, 30, 80, 90], OPS_MarkupNumberValue: PDFHexString.fromText(value) }));
  const zero = annotation('-0');
  const negative = annotation('-7.25');
  const invalid = annotation('1e1000');
  const oversized = annotation('9'.repeat(3000));
  page.node.set(PDFName.of('Annots'), context.obj([zero, negative, invalid, oversized]));
  const reopened = await PDFDocument.load(await pdf.save());
  const map = await extractAnnotationColors(1, reopened);
  const byRef = ref => map.get(`@ref:${ref.objectNumber}R${ref.generationNumber || ''}`);
  assert.equal(byRef(zero)?.markupNumberValue, 0);
  assert.equal(byRef(negative)?.markupNumberValue, -7.25);
  assert.equal(byRef(invalid)?.markupNumberValue, undefined);
  assert.equal(byRef(oversized)?.markupNumberValue, undefined);
});
