import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { checkmarkColumn, checkmarkRank, checkmarkText, checkmarkValue } from '../annotations/custom-checkmark-column.js';
import { saveMarkupTextColumn } from './markup-text-column.js';
import { saveMarkupChoiceColumn } from './markup-choice-column.js';
import { saveMarkupNumberColumn } from './markup-number-column.js';
import { ensureMarkupColumnsReady } from './markup-columns.js';
import { markupCheckmarkColumnForSave, readMarkupCheckmarkColumn,
  saveMarkupCheckmarkColumn } from './markup-checkmark-column.js';
import { extractAnnotationColors } from './loader/color-extraction.js';

const DEFINITION = { version: 1, name: 'Verified' };
const CHOICE = { version: 1, name: 'Disposition', options: ['Review', 'Approved'] };
const NUMBER = { version: 1, name: 'Quantity' };

test('Checkmark schema has three explicit states and unique bounded names', () => {
  assert.deepEqual(checkmarkColumn(DEFINITION, 'Review note', CHOICE.name, NUMBER.name), DEFINITION);
  for (const duplicate of ['Review note', 'Disposition', 'Quantity']) {
    assert.equal(checkmarkColumn({ ...DEFINITION, name: duplicate }, 'Review note', CHOICE.name, NUMBER.name), null);
  }
  for (const invalid of [{ ...DEFINITION, version: 2 }, { ...DEFINITION, default: 'unchecked' },
    { ...DEFINITION, name: 'A\nB' }, { ...DEFINITION, name: 'Status' }]) {
    assert.equal(checkmarkColumn(invalid), null);
  }
  assert.equal(checkmarkValue(null), null);
  assert.equal(checkmarkValue('unchecked'), 'unchecked');
  assert.equal(checkmarkValue('checked'), 'checked');
  for (const invalid of ['false', 'true', false, true, 'Checked', '']) assert.equal(checkmarkValue(invalid), null);
  assert.deepEqual([null, 'unchecked', 'checked'].map(checkmarkRank), [0, 1, 2]);
  assert.deepEqual([null, 'unchecked', 'checked'].map(checkmarkText), ['', 'Unchecked', 'Checked']);
});

test('Checkmark catalog survives two real PDF saves and protects pending source names', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupTextColumn(pdf, 'Review note');
  saveMarkupChoiceColumn(pdf, CHOICE);
  saveMarkupNumberColumn(pdf, NUMBER);
  saveMarkupCheckmarkColumn(pdf, DEFINITION);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(readMarkupCheckmarkColumn(pdf), DEFINITION);
    const doc = { markupTextColumnName: '', markupChoiceColumn: null, markupNumberColumn: null,
      markupCheckmarkColumn: null, _sharedPdfLibDocPromise: Promise.resolve(pdf) };
    await ensureMarkupColumnsReady(doc);
    assert.deepEqual(doc.markupCheckmarkColumn, DEFINITION);
    assert.deepEqual(markupCheckmarkColumnForSave(doc, pdf, doc.markupTextColumnName,
      doc.markupChoiceColumn, doc.markupNumberColumn), DEFINITION);
    saveMarkupCheckmarkColumn(pdf, doc.markupCheckmarkColumn);
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  const key = PDFName.of('OPS_MarkupCheckmarkColumnV1');
  const original = catalog.lookup(key).decodeText();
  for (const colliding of ['Review note', CHOICE.name, NUMBER.name]) {
    assert.throws(() => markupCheckmarkColumnForSave({ markupCheckmarkColumn: { ...DEFINITION, name: colliding } },
      pdf, 'Review note', CHOICE, NUMBER), /different names/u);
    assert.equal(catalog.lookup(key).decodeText(), original);
  }
  for (const invalid of [PDFHexString.fromText('{broken'), PDFHexString.fromText('X'.repeat(2000)),
    PDFHexString.fromText(JSON.stringify({ ...DEFINITION, default: 'checked' }))]) {
    catalog.set(key, invalid);
    assert.equal(readMarkupCheckmarkColumn(pdf), null);
  }
});

test('co-located Checkmark values use PDF references; invalid and oversized states are ignored', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const context = pdf.context;
  const annotation = value => context.register(context.obj({ Type: 'Annot', Subtype: 'Square',
    Rect: [20, 30, 80, 90], ...(value == null ? {} : { OPS_MarkupCheckmarkValue: PDFHexString.fromText(value) }) }));
  const checked = annotation('checked');
  const unchecked = annotation('unchecked');
  const blank = annotation(null);
  const invalid = annotation('false');
  const oversized = annotation('x'.repeat(3000));
  page.node.set(PDFName.of('Annots'), context.obj([checked, unchecked, blank, invalid, oversized]));
  const reopened = await PDFDocument.load(await pdf.save());
  const map = await extractAnnotationColors(1, reopened);
  const byRef = ref => map.get(`@ref:${ref.objectNumber}R${ref.generationNumber || ''}`);
  assert.equal(byRef(checked)?.markupCheckmarkValue, 'checked');
  assert.equal(byRef(unchecked)?.markupCheckmarkValue, 'unchecked');
  assert.equal(byRef(blank)?.markupCheckmarkValue, undefined);
  assert.equal(byRef(invalid)?.markupCheckmarkValue, undefined);
  assert.equal(byRef(oversized)?.markupCheckmarkValue, undefined);
});
