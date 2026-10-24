import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { choiceColumn, choiceNumericValue, choiceValue } from '../annotations/custom-choice-column.js';
import { markupChoiceColumnForSave, readMarkupChoiceColumn,
  saveMarkupChoiceColumn } from './markup-choice-column.js';
import { ensureMarkupColumnsReady } from './markup-columns.js';
import { saveMarkupTextColumn } from './markup-text-column.js';
import { extractAnnotationColors } from './loader/color-extraction.js';

const DEFINITION = { version: 1, name: 'Disposition', options: ['Review', 'Approved', 'Hold'] };
const NUMERIC = { version: 2, name: 'Disposition', options: ['Review', 'Approved', 'Hold'],
  numericValues: ['12.5', null, '0'] };

test('Choice schema accepts only bounded distinct named options and one defined value', () => {
  assert.deepEqual(choiceColumn(DEFINITION), DEFINITION);
  assert.equal(choiceValue('Approved', DEFINITION.options), 'Approved');
  for (const value of ['', 'unknown', 'Approved\n', '=HYPERLINK("x")']) {
    assert.equal(choiceValue(value, DEFINITION.options), '');
  }
  for (const invalid of [
    { ...DEFINITION, version: 2 },
    { ...DEFINITION, extra: 'ignored?' },
    { ...DEFINITION, name: 'Status' },
    { ...DEFINITION, name: 'A\nB' },
    { ...DEFINITION, options: [] },
    { ...DEFINITION, options: ['Review', 'review'] },
    { ...DEFINITION, options: ['A'.repeat(49)] },
    { ...DEFINITION, options: Array.from({ length: 21 }, (_, i) => `Option ${i}`) },
  ]) assert.equal(choiceColumn(invalid), null);
  assert.equal(choiceColumn(DEFINITION, 'Disposition'), null, 'Choice and Text headings must differ');
});

test('Choice numeric values are bounded, optional, and preserve displayed labels', () => {
  assert.deepEqual(choiceColumn(NUMERIC), NUMERIC);
  assert.equal(choiceValue('Review', NUMERIC.options), 'Review');
  assert.equal(choiceNumericValue('Review', NUMERIC), '12.5');
  assert.equal(choiceNumericValue('Approved', NUMERIC), null);
  assert.equal(choiceNumericValue('Hold', NUMERIC), '0');
  assert.equal(choiceNumericValue('Unknown', NUMERIC), null);
  for (const invalid of [{ ...NUMERIC, numericValues: ['1e3', null, '0'] },
    { ...NUMERIC, numericValues: ['1.0', null, '0'] },
    { ...NUMERIC, numericValues: [null, null, null] },
    { ...NUMERIC, numericValues: ['1'] },
    { ...NUMERIC, extra: true }]) assert.equal(choiceColumn(invalid), null);
});

test('numeric Choice catalog preserves v1 labels and ignores a malformed or mismatched v2 mapping', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupChoiceColumn(pdf, NUMERIC);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(readMarkupChoiceColumn(pdf), NUMERIC);
    const labels = JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupChoiceColumnV1')).decodeText());
    assert.deepEqual(labels, DEFINITION);
    assert.deepEqual(markupChoiceColumnForSave({ markupChoiceColumn: null }, pdf), NUMERIC);
    saveMarkupChoiceColumn(pdf, NUMERIC);
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  const key = PDFName.of('OPS_MarkupChoiceColumnV2');
  catalog.set(key, PDFHexString.fromText('{broken'));
  assert.deepEqual(readMarkupChoiceColumn(pdf), DEFINITION);
  catalog.set(key, PDFHexString.fromText(JSON.stringify({ ...NUMERIC,
    options: ['Review', 'Approved', 'Other'] })));
  assert.deepEqual(readMarkupChoiceColumn(pdf), DEFINITION);
  saveMarkupChoiceColumn(pdf, DEFINITION);
  assert.equal(catalog.get(key), undefined);
});

test('strict versioned catalog survives two PDF saves and rejects malformed metadata', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupTextColumn(pdf, 'Reviewer note');
  saveMarkupChoiceColumn(pdf, DEFINITION);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(readMarkupChoiceColumn(pdf), DEFINITION);
    assert.deepEqual(markupChoiceColumnForSave({ markupChoiceColumn: null,
      markupTextColumnName: '' }, pdf), DEFINITION, 'early save recovers source catalog');
    saveMarkupChoiceColumn(pdf, readMarkupChoiceColumn(pdf));
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  const key = PDFName.of('OPS_MarkupChoiceColumnV1');
  for (const invalid of [
    PDFHexString.fromText(JSON.stringify({ ...DEFINITION, options: ['Review', 'Review'] })),
    PDFHexString.fromText('X'.repeat(3000)),
    PDFString.of('{broken json'),
  ]) {
    catalog.set(key, invalid);
    assert.equal(readMarkupChoiceColumn(pdf), null);
  }
  saveMarkupChoiceColumn(pdf, null);
  assert.equal(catalog.get(key), undefined);
});

test('co-located annotation values keep reference identity and oversized PDF strings are ignored', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const context = pdf.context;
  const annotation = value => context.register(context.obj({ Type: 'Annot', Subtype: 'Square',
    Rect: [20, 30, 80, 90], OPS_MarkupChoiceValue: PDFHexString.fromText(value) }));
  const valid = annotation('Approved');
  const oversized = annotation('A'.repeat(3000));
  page.node.set(PDFName.of('Annots'), context.obj([valid, oversized]));
  const reopened = await PDFDocument.load(await pdf.save());
  const map = await extractAnnotationColors(1, reopened);
  assert.equal(map.get(`@ref:${valid.objectNumber}R${valid.generationNumber || ''}`)?.markupChoiceValue, 'Approved');
  assert.equal(map.get(`@ref:${oversized.objectNumber}R${oversized.generationNumber || ''}`)?.markupChoiceValue, undefined);
});

test('pending catalog read hydrates both columns before edits and exports', async () => {
  const source = await PDFDocument.create();
  source.addPage([400, 500]);
  saveMarkupTextColumn(source, 'Reviewer note');
  saveMarkupChoiceColumn(source, DEFINITION);
  const reopened = await PDFDocument.load(await source.save());
  let release;
  const doc = { markupTextColumnName: '', markupChoiceColumn: null,
    _sharedPdfLibDocPromise: new Promise(resolve => { release = resolve; }) };
  const ready = ensureMarkupColumnsReady(doc);
  assert.equal(doc.markupChoiceColumn, null, 'editing/export must await the source');
  release(reopened);
  await ready;
  assert.equal(doc.markupTextColumnName, 'Reviewer note');
  assert.deepEqual(doc.markupChoiceColumn, DEFINITION);
});

test('colliding Text and Choice names reject save before catalog mutation', async () => {
  const source = await PDFDocument.create();
  source.addPage([400, 500]);
  saveMarkupTextColumn(source, 'Reviewer note');
  saveMarkupChoiceColumn(source, DEFINITION);
  const pdf = await PDFDocument.load(await source.save());
  const before = pdf.catalog.lookup(PDFName.of('OPS_MarkupChoiceColumnV1')).decodeText();
  assert.throws(() => markupChoiceColumnForSave({ markupTextColumnName: 'Disposition',
    markupChoiceColumn: null }, pdf), /different names/u,
  'new Text name must not delete a pending source Choice');
  assert.throws(() => markupChoiceColumnForSave({ markupTextColumnName: '',
    markupChoiceColumn: { ...DEFINITION, name: 'Reviewer note' } }, pdf), /different names/u,
  'new Choice name must not hide a pending source Text');
  saveMarkupTextColumn(pdf, 'Disposition');
  assert.throws(() => saveMarkupChoiceColumn(pdf, DEFINITION), /different names/u);
  assert.equal(pdf.catalog.lookup(PDFName.of('OPS_MarkupChoiceColumnV1')).decodeText(), before,
    'a direct writer must also leave existing Choice metadata untouched');
});
