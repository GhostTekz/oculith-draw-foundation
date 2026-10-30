import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { suggestSheetDetails } from './sheet-title-suggest.js';

function item(str, x, y) {
  return { str, transform: [10, 0, 0, 10, x, y], width: str.length * 6, height: 10 };
}

const viewport = { width: 1000, height: 700, convertToViewportPoint: (x, y) => [x, y] };

test('only clearly labeled selectable text in the lower or right title block is suggested', () => {
  const result = suggestSheetDetails([
    item('SHEET NO. Z-999', 100, 100),
    item('SHEET NO.', 720, 560), item('A-101', 720, 590),
    item('SHEET TITLE', 720, 620), item('FIRST FLOOR PLAN', 720, 650),
  ], viewport);
  assert.equal(result.label, 'A-101');
  assert.equal(result.title, 'FIRST FLOOR PLAN');
  assert.match(result.evidence.label, /SHEET NO\. \/ A-101/u);
  assert.match(result.evidence.title, /SHEET TITLE \/ FIRST FLOOR PLAN/u);
  assert.equal(result.snippets.includes('SHEET NO. Z-999'), false);
});

test('ambiguous numbers are left for manual review; blank pages have no suggestion', () => {
  const ambiguous = suggestSheetDetails([
    item('SHEET NO. A-101', 720, 550), item('SHEET NO. A-102', 720, 600),
  ], viewport);
  assert.equal(ambiguous.label, '');
  assert.equal(ambiguous.selectableText, true);
  assert.deepEqual(suggestSheetDetails([], viewport), {
    label: '', title: '', evidence: { label: '', title: '' }, snippets: [], selectableText: false,
  });
});

test('extracts a reviewable suggestion from a real vector PDF title block', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1000, 700]);
  for (const [text, y] of [['SHEET NO.', 140], ['A-101', 110], ['SHEET TITLE', 80], ['FIRST FLOOR PLAN', 50]]) {
    page.drawText(text, { x: 720, y, font, size: 12 });
  }
  page.drawText('SHEET NO. Z-999', { x: 100, y: 600, font, size: 12 });
  const task = getDocument({ data: new Uint8Array(await pdf.save()), useSystemFonts: true });
  try {
    const document = await task.promise;
    const source = await document.getPage(1);
    const content = await source.getTextContent();
    const result = suggestSheetDetails(content.items, source.getViewport({ scale: 1 }));
    assert.deepEqual([result.label, result.title], ['A-101', 'FIRST FLOOR PLAN']);
  } finally {
    await task.destroy();
  }
});
