import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { applyIndexSheetTitleReview, indexSheetTitleSuggestions } from './index-sheet-titles.js';

const hash = 'a'.repeat(64);
const sheets = [
  { id: 'one', label: 'A-101', title: '', filePath: '/set.pdf', page: 1, sourceSha256: hash },
  { id: 'two', label: 'A-102', title: '', filePath: '/set.pdf', page: 2, sourceSha256: hash },
];
const viewport = { width: 1000, height: 700, convertToViewportPoint: (x, y) => [x, y] };
function item(str, x, y) {
  return { str, transform: [10, 0, 0, 10, x, y], width: str.length * 6, height: 10 };
}

test('matches exact registered IDs from rows and reports duplicates and unmatched IDs', () => {
  const result = indexSheetTitleSuggestions([
    item('A-101', 50, 80), item('FIRST FLOOR PLAN', 200, 80),
    item('A-102 SECOND FLOOR PLAN', 50, 120),
    item('A-102 ROOF PLAN', 50, 160),
    item('A-103 THIRD FLOOR PLAN', 50, 200),
    item('A-101', 50, 240), item('Revision 2', 200, 240),
    item('A-101 STAIR PLAN A-102 ROOF PLAN', 50, 280),
  ], viewport, sheets);
  assert.equal(result.matched.get('one').title, 'FIRST FLOOR PLAN');
  assert(result.matched.get('one').rect.width > 0);
  assert.equal(result.matched.has('two'), false);
  assert.equal(result.conflicts[0].sheetId, 'two');
  assert.deepEqual(result.unmatched.map(row => row.text), ['A-103 THIRD FLOOR PLAN']);
});

test('index reviews update titles only and preserve sources and stable IDs', () => {
  const register = { version: 1, sheets };
  const row = { sheetId: 'one', originalLabel: 'A-101', label: 'A-101', title: 'FIRST FLOOR PLAN',
    filePath: '/set.pdf', page: 1, sourceSha256: hash, selected: true };
  const next = applyIndexSheetTitleReview(register, [row]);
  assert.equal(next.sheets[0].title, 'FIRST FLOOR PLAN');
  assert.equal(next.sheets[0].id, 'one');
  assert.equal(next.sheets[0].filePath, '/set.pdf');
  assert.equal(register.sheets[0].title, '');
  assert.throws(() => applyIndexSheetTitleReview(register, [{ ...row, label: 'A-999' }]), /titles only/u);
  assert.throws(() => applyIndexSheetTitleReview(register, [{ ...row, sourceSha256: '' }]), /could not be verified/u);
});

test('refuses oversized index text instead of silently showing a partial review', () => {
  assert.throws(() => indexSheetTitleSuggestions(Array.from({ length: 5001 }, () => item('x', 1, 1)),
    viewport, sheets), /too much text/u);
});

test('extracts separated columns from one real vector PDF index page', async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1000, 700]);
  page.drawText('DRAWING INDEX', { x: 50, y: 650, font, size: 16 });
  for (const [id, title, y] of [['A-101', 'FIRST FLOOR PLAN', 600],
    ['A-102', 'SECOND FLOOR PLAN', 570], ['A-103', 'UNREGISTERED PLAN', 540]]) {
    page.drawText(id, { x: 50, y, font, size: 12 });
    page.drawText(title, { x: 200, y, font, size: 12 });
  }
  const task = getDocument({ data: new Uint8Array(await pdf.save()), useSystemFonts: true });
  try {
    const document = await task.promise;
    const source = await document.getPage(1);
    const content = await source.getTextContent();
    const result = indexSheetTitleSuggestions(content.items, source.getViewport({ scale: 1 }), sheets);
    assert.deepEqual([...result.matched].map(([id, row]) => [id, row.title]), [
      ['one', 'FIRST FLOOR PLAN'], ['two', 'SECOND FLOOR PLAN'],
    ]);
    assert.equal(result.unmatched.length, 1);
  } finally { await task.destroy(); }
});
