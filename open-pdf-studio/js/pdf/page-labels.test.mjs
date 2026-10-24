import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import {
  formatLabelNumber, labelsFromRanges, rangesFromLabels, applyNumbering,
  readPageLabelRanges, writePageLabels, proposeLabelsFromTexts, cleanPageLabel,
} from './page-labels.js';

async function pdfjsLabels(bytes) {
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    return await doc.getPageLabels();
  } finally {
    await task.destroy();
  }
}

test('number styles follow ISO 32000 (decimal, roman, letters AA after Z)', () => {
  assert.equal(formatLabelNumber(14, 'D'), '14');
  assert.equal(formatLabelNumber(14, 'R'), 'XIV');
  assert.equal(formatLabelNumber(4, 'r'), 'iv');
  assert.equal(formatLabelNumber(1, 'A'), 'A');
  assert.equal(formatLabelNumber(27, 'A'), 'AA');
  assert.equal(formatLabelNumber(28, 'a'), 'bb');
  assert.equal(formatLabelNumber(3, ''), '');
});

test('labels compress to the fewest ranges and expand back unchanged', () => {
  const labels = ['i', 'ii', 'A-101', 'A-102', 'A-103', 'S2.01', 'S2.02', 'COVER', '', ''];
  const ranges = rangesFromLabels(labels);
  assert.deepEqual(ranges, [
    { page: 1, style: 'r', prefix: '', start: 1 },
    { page: 3, style: 'D', prefix: 'A-', start: 101 },
    { page: 6, style: 'D', prefix: 'S2.0', start: 1 },
    { page: 8, style: '', prefix: 'COVER', start: 1 },
    { page: 9, style: 'D', prefix: '', start: 9 },
  ]);
  // Blank labels come back as their page number (readers show the number).
  assert.deepEqual(labelsFromRanges(ranges, 10), [...labels.slice(0, 8), '9', '10']);
});

test('numbering ranges overwrite only the chosen pages', () => {
  const out = applyNumbering(['x', 'x', 'x', 'x'], { from: 2, to: 3, style: 'D', prefix: 'E-', start: 201 });
  assert.deepEqual(out, ['x', 'E-201', 'E-202', 'x']);
  assert.deepEqual(applyNumbering(['', '', ''], { from: 1, to: 3, style: 'A', prefix: 'App ', start: 1 }),
    ['App A', 'App B', 'App C']);
});

test('/PageLabels written with pdf-lib survive save and reopen (PDF.js and pdf-lib)', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 5; i++) pdf.addPage([612, 792]);
  const labels = ['COVER', 'A-101', 'A-102', 'A-103', 'Détail ½'];
  writePageLabels(pdf, labels);
  const bytes = await pdf.save();

  assert.deepEqual(await pdfjsLabels(bytes), labels);
  const reopened = await PDFDocument.load(bytes);
  assert.deepEqual(labelsFromRanges(readPageLabelRanges(reopened), 5), labels);

  // Clearing every label removes the entry; PDF.js then reports none.
  writePageLabels(reopened, ['', '', '', '', '']);
  const cleared = await reopened.save();
  assert.equal(await pdfjsLabels(cleared), null);
});

test('reads a /PageLabels tree with /Kids written by another program', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 4; i++) pdf.addPage();
  const ctx = pdf.context;
  const kidA = ctx.obj({ Nums: [0, { S: PDFName.of('r') }], Limits: [0, 0] });
  const kidB = ctx.obj({ Nums: [2, { S: PDFName.of('D'), P: PDFHexString.fromText('M-'), St: 5 }], Limits: [2, 2] });
  pdf.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Kids: [ctx.register(kidA), ctx.register(kidB)] }));
  const bytes = await pdf.save();
  const reopened = await PDFDocument.load(bytes);
  assert.deepEqual(labelsFromRanges(readPageLabelRanges(reopened), 4), ['i', 'ii', 'M-5', 'M-6']);
  assert.deepEqual(await pdfjsLabels(bytes), ['i', 'ii', 'M-5', 'M-6']);
});

test('region proposals keep blanks, de-duplicate and clean the text', () => {
  const rows = proposeLabelsFromTexts(['A-101', '  ', 'A-101', 'A-\n103\t', 'a-101'], ['1', 'COVER', '', '', '']);
  assert.deepEqual(rows.map(r => [r.page, r.label, r.note]), [
    [1, 'A-101', null],
    [2, 'COVER', 'blank'],
    [3, 'A-101 (2)', 'duplicate'],
    [4, 'A- 103', null],
    [5, 'a-101 (3)', 'duplicate'],
  ]);
  assert.equal(cleanPageLabel('x'.repeat(300)).length, 128);
});
