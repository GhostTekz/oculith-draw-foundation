import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { readMarkupSecondNumberColumn, saveMarkupSecondNumberColumn,
  secondNumberColumnForSave } from './markup-second-number-column.js';
import { readMarkupNumberColumn, saveMarkupNumberColumn } from './markup-number-column.js';
import { extractAnnotationColors } from './loader/color-extraction.js';

const FIRST = { version: 1, name: 'Quantity' };
const SECOND = { version: 1, name: 'Unit cost' };

test('second Number definition is independent and one-column PDFs remain readable', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupNumberColumn(pdf, FIRST);
  assert.equal(readMarkupSecondNumberColumn(pdf), null);
  saveMarkupSecondNumberColumn(pdf, SECOND);
  assert.deepEqual(secondNumberColumnForSave({ markupNumberColumn2: null }, pdf,
    [FIRST.name]), SECOND, 'a pending catalog read cannot erase the second column');
  assert.throws(() => secondNumberColumnForSave({ markupNumberColumn2: { ...SECOND, name: 'quantity' } },
    pdf, [FIRST.name]), /different names/u);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(readMarkupNumberColumn(pdf), FIRST);
    assert.deepEqual(readMarkupSecondNumberColumn(pdf), SECOND);
    saveMarkupSecondNumberColumn(pdf, SECOND);
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  catalog.set(PDFName.of('OPS_MarkupNumberColumn2V1'), PDFHexString.fromText('X'.repeat(3000)));
  assert.equal(readMarkupSecondNumberColumn(pdf), null);
  saveMarkupSecondNumberColumn(pdf, null);
  assert.equal(catalog.get(PDFName.of('OPS_MarkupNumberColumn2V1')), undefined);
});

test('second-only numeric values on identical rectangles retain reference identity, including zero', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const context = pdf.context;
  const annotation = value => context.register(context.obj({ Type: 'Annot', Subtype: 'Square',
    Rect: [20, 30, 80, 90], ...(value === null ? {}
      : { OPS_MarkupNumberValue2V1: PDFHexString.fromText(value) }) }));
  const negative = annotation('-7.25');
  const zero = annotation('0');
  const blank = annotation(null);
  const oversized = annotation('X'.repeat(3000));
  page.node.set(PDFName.of('Annots'), context.obj([negative, zero, blank, oversized]));
  const reopened = await PDFDocument.load(await pdf.save());
  const map = await extractAnnotationColors(1, reopened);
  const valueFor = ref => map.get(`@ref:${ref.objectNumber}R${ref.generationNumber || ''}`)?.markupNumberValue2;
  assert.equal(valueFor(negative), -7.25);
  assert.equal(valueFor(zero), 0);
  assert.equal(valueFor(blank), undefined);
  assert.equal(valueFor(oversized), undefined);
});
