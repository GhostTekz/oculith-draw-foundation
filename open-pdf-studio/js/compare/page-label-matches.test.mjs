import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { suggestPagePairsByLabel, suggestPagePairsFromDocs } from './page-label-matches.js';
import { canConfirmSuggestedPair, confirmPagePair } from './page-pairs.js';

test('only unique matching labels are suggested; duplicates and unmatched pages stay visible', () => {
  const result = suggestPagePairsByLabel(
    ['A-101', 'A-102', 'A-102', 'X-001', '', 'a-103'], 6,
    ['A-102', 'A-101', 'A-102', 'Y-001', 'a-103'], 5,
  );
  assert.deepEqual(result.suggestions, [
    { label: 'A-101', oldPage: 1, newPage: 2 },
    { label: 'a-103', oldPage: 6, newPage: 5 },
  ]);
  assert.deepEqual(result.ambiguities, [{ label: 'A-102', oldPages: [2, 3], newPages: [1, 3] }]);
  assert.deepEqual(result.unmatchedOld, [{ page: 4, label: 'X-001' }, { page: 5, label: '' }]);
  assert.deepEqual(result.unmatchedNew, [{ page: 4, label: 'Y-001' }]);
});

test('missing embedded labels never fall back to equal page indexes', () => {
  const result = suggestPagePairsByLabel(null, 2, ['1', '2'], 2);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.hasOldLabels, false);
  assert.deepEqual(result.unmatchedOld.map(item => item.page), [1, 2]);
  assert.deepEqual(result.unmatchedNew.map(item => item.page), [1, 2]);
});

test('existing manual match blocks suggested pair replacement', () => {
  const confirmed = confirmPagePair([], 1, 3, '2026-10-13T00:00:00.000Z');
  assert.equal(canConfirmSuggestedPair(confirmed, 1, 2), false);
  assert.equal(canConfirmSuggestedPair(confirmed, 2, 3), false);
  assert.equal(canConfirmSuggestedPair(confirmed, 2, 4), true);
});

test('reads embedded labels from two real PDFs with pages in different order', async () => {
  async function makePdf(prefixes) {
    const pdf = await PDFDocument.create();
    prefixes.forEach(() => pdf.addPage());
    pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({
      Nums: prefixes.flatMap((prefix, index) => [index, { P: PDFHexString.fromText(prefix), S: PDFName.of('D'), St: 1 }]),
    }));
    return pdf.save();
  }
  const oldBytes = await makePdf(['A-101-', 'A-102-']);
  const newBytes = await makePdf(['A-102-', 'A-101-']);
  const oldTask = pdfjsLib.getDocument({ data: Uint8Array.from(oldBytes), isEvalSupported: false });
  const newTask = pdfjsLib.getDocument({ data: Uint8Array.from(newBytes), isEvalSupported: false });
  try {
    const [oldDoc, newDoc] = await Promise.all([oldTask.promise, newTask.promise]);
    const result = await suggestPagePairsFromDocs(oldDoc, newDoc);
    assert.deepEqual(result.suggestions, [
      { label: 'A-101-1', oldPage: 1, newPage: 2 },
      { label: 'A-102-1', oldPage: 2, newPage: 1 },
    ]);
    assert.deepEqual(result.ambiguities, []);
  } finally {
    await Promise.all([oldTask.destroy(), newTask.destroy()]);
  }
});
