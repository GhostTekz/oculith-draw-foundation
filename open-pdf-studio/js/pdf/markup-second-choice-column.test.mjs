import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { saveMarkupChoiceColumn, readMarkupChoiceColumn } from './markup-choice-column.js';
import { readMarkupSecondChoiceColumn, saveMarkupSecondChoiceColumn,
  secondChoiceColumnForSave } from './markup-second-choice-column.js';
import { extractAnnotationColors } from './loader/color-extraction.js';

const FIRST = { version: 2, name: 'Rate', options: ['Standard', 'Premium'],
  numericValues: ['10', '20'] };
const SECOND = { version: 2, name: 'Disposition', options: ['Review', 'Approved'],
  numericValues: [null, '7.5'] };

test('second Choice catalog keeps independent labels and numeric mappings through two saves', async () => {
  let pdf = await PDFDocument.create();
  pdf.addPage([400, 500]);
  saveMarkupChoiceColumn(pdf, FIRST);
  assert.equal(readMarkupSecondChoiceColumn(pdf), null, 'one-Choice PDFs remain valid');
  saveMarkupSecondChoiceColumn(pdf, SECOND);
  assert.deepEqual(secondChoiceColumnForSave({ markupChoiceColumn2: null }, pdf,
    [FIRST.name]), SECOND, 'an early save recovers source metadata');
  assert.throws(() => secondChoiceColumnForSave({ markupChoiceColumn2: { ...SECOND, name: 'rate' } },
    pdf, [FIRST.name]), /different names/u);
  for (let cycle = 0; cycle < 2; cycle++) {
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(readMarkupChoiceColumn(pdf), FIRST);
    assert.deepEqual(readMarkupSecondChoiceColumn(pdf), SECOND);
    assert.deepEqual(JSON.parse(pdf.catalog.lookup(PDFName.of('OPS_MarkupChoiceColumn2V1')).decodeText()),
      { version: 1, name: SECOND.name, options: SECOND.options });
    saveMarkupSecondChoiceColumn(pdf, SECOND);
  }
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  catalog.set(PDFName.of('OPS_MarkupChoiceColumn2V2'), PDFHexString.fromText('{bad'));
  assert.deepEqual(readMarkupSecondChoiceColumn(pdf), { version: 1,
    name: SECOND.name, options: SECOND.options });
  catalog.set(PDFName.of('OPS_MarkupChoiceColumn2V1'), PDFHexString.fromText('X'.repeat(3000)));
  assert.equal(readMarkupSecondChoiceColumn(pdf), null);
});

test('second-only values on identical rectangles receive reference identities, including blanks', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 500]);
  const context = pdf.context;
  const annotation = value => context.register(context.obj({ Type: 'Annot', Subtype: 'Square',
    Rect: [20, 30, 80, 90], ...(value ? { OPS_MarkupChoiceValue2V1: PDFHexString.fromText(value) } : {}) }));
  const first = annotation('Review');
  const second = annotation('Approved');
  const blank = annotation('');
  const oversized = annotation('X'.repeat(3000));
  page.node.set(PDFName.of('Annots'), context.obj([first, second, blank, oversized]));
  const reopened = await PDFDocument.load(await pdf.save());
  const map = await extractAnnotationColors(1, reopened);
  const valueFor = ref => map.get(`@ref:${ref.objectNumber}R${ref.generationNumber || ''}`)?.markupChoiceValue2;
  assert.equal(valueFor(first), 'Review');
  assert.equal(valueFor(second), 'Approved');
  assert.equal(valueFor(blank), undefined);
  assert.equal(valueFor(oversized), undefined);
});
