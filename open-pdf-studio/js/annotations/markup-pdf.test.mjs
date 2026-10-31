import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { markupCsv, markupSummaryRows } from './markup-csv.js';
import { buildMarkupSummaryPdf } from './markup-pdf.js';

const fontBytes = await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

async function reopen(bytes) {
  const document = await PDFDocument.load(bytes);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const reader = await task.promise;
  const pages = [];
  for (let number = 1; number <= reader.numPages; number++) {
    const content = await (await reader.getPage(number)).getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  await task.destroy();
  return { document, pages, text: pages.join(' ') };
}

test('markup PDF reopens with the CSV row grouping, source, status, full text and unverified measurement', async () => {
  const annotations = [
    { id: 'one', page: 2, type: 'comment', subject: 'Door', status: 'accepted', author: 'Alex', text: 'Check Résumé 旧', replies: [{ author: 'Pat', text: 'Verify clearance' }], layer: 'Review' },
    { id: 'parent', page: 3, type: 'caret', intent: 'Replace', text: 'new', author: 'Jo' },
    { id: 'child', page: 3, type: 'textStrikethrough', inReplyTo: 'parent', replyType: 'group', markedText: 'old', author: 'Jo' },
    { id: 'measure', page: 4, type: 'measureDistance', subject: 'Entry', status: 'completed', measureText: '12.5 ft', text: 'Clear width' },
  ];
  const rows = markupSummaryRows(annotations);
  assert.equal(rows.length, 3);
  assert.match(markupCsv(annotations), /"old -> new"/u);
  const result = await reopen(await buildMarkupSummaryPdf({
    sourcePath: '/plans/Résumé 旧.pdf', rows, generatedAt: new Date('2026-10-13T20:00:00.000Z'),
  }, fontBytes));
  assert.equal(result.document.getPageCount(), 1);
  assert.match(result.text, /MARKUPS LIST SUMMARY/u);
  assert.match(result.text, /Source PDF: \/plans\/Résumé \[U\+65E7\]\.pdf/u);
  assert.match(result.text, /3 markups/u);
  assert.match(result.text, /Page 2 \| comment/u);
  assert.match(result.text, /Subject: Door \| Status: accepted \| Author: Alex/u);
  assert.match(result.text, /Text: Check Résumé \[U\+65E7\]/u);
  assert.match(result.text, /Replies: Pat: Verify clearance/u);
  assert.match(result.text, /Text: old -> new/u);
  assert.doesNotMatch(result.text, /Page 3 \| textStrikethrough/u);
  assert.match(result.text, /Measurement shown on markup: 12\.5 ft \| UNVERIFIED/u);
  assert.match(result.text, /scale and units not validated by this report/u);
  assert.match(result.text, /CSV export retains the original text/u);
});

test('selected PDF summary and long markup text paginate without including unselected rows', async () => {
  const annotations = [
    { id: 'skip', page: 1, type: 'comment', text: 'Do not export me' },
    { id: 'keep', page: 7, type: 'measureArea', measureValue: 120, measureUnit: 'm²', text: 'Area review', replies: [{ author: 'Alex', text: 'Check again '.repeat(600) }] },
  ];
  const rows = markupSummaryRows(annotations, [annotations[1]]);
  assert.equal(rows.length, 1);
  const result = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'drawing.pdf', rows }, fontBytes));
  assert.ok(result.document.getPageCount() > 1);
  assert.match(result.text, /Page 7 \| measureArea/u);
  assert.match(result.text, /Measurement shown on markup: 120 m² \| UNVERIFIED/u);
  assert.doesNotMatch(result.text, /Do not export me/u);
  assert.match(result.pages.at(-1), /Page \d+ of \d+/u);
});

test('PDF summary prints the same bounded custom text row as CSV', async () => {
  const annotations = [{ id: 'one', page: 1, type: 'comment', markupTextValue: 'Phase 2' }];
  const rows = markupSummaryRows(annotations);
  assert.equal(rows[0].customTextValue, 'Phase 2');
  assert.match(markupCsv(annotations, null, 'Review phase'), /"Phase 2"/u);
  const result = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customTextColumn: 'Review phase' }, fontBytes));
  assert.match(result.text, /Review phase: Phase 2/u);
});

test('PDF summary prints both Text columns from the selected row', async () => {
  const annotations = [{ id: 'one', page: 1, type: 'comment', markupTextValue: 'Phase 2',
    markupTextValue2: 'Inspected' }, { id: 'two', page: 1, type: 'comment', markupTextValue2: 'Exclude' }];
  const rows = markupSummaryRows(annotations, [annotations[0]]);
  assert.equal(rows[0].customTextValue2, 'Inspected');
  const result = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customTextColumn: 'Review phase', customSecondTextColumn: 'Inspector note' }, fontBytes));
  assert.match(result.text, /Review phase: Phase 2/u);
  assert.match(result.text, /Inspector note: Inspected/u);
  assert.doesNotMatch(result.text, /Exclude/u);
});

test('PDF summary prints the defined Choice selection from the normalized row', async () => {
  const choice = { version: 1, name: 'Disposition', options: ['Approved', 'Hold'] };
  const annotations = [{ id: 'one', page: 1, type: 'comment', markupTextValue: 'Door', markupChoiceValue: 'Hold' }];
  const rows = markupSummaryRows(annotations, null, choice);
  assert.equal(rows[0].customChoiceValue, 'Hold');
  const result = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customTextColumn: 'Reviewer note', customChoiceColumn: choice }, fontBytes));
  assert.match(result.text, /Reviewer note: Door/u);
  assert.match(result.text, /Disposition: Hold/u);
});

test('PDF summary renders second Choice independently and keeps Formula on first Choice', async () => {
  const first = { version: 2, name: 'Rate', options: ['Standard'], numericValues: ['10'] };
  const second = { version: 2, name: 'Disposition', options: ['Approved'], numericValues: ['7.5'] };
  const formula = { version: 2, name: 'Adjusted', source: 'customChoice',
    multiplier: '2', offset: '0' };
  const annotations = [{ id: 'one', page: 1, type: 'box', markupChoiceValue: 'Standard',
    markupChoiceValue2: 'Approved' }];
  const rows = markupSummaryRows(annotations, null, first, null, null, formula, second);
  assert.equal(rows[0].customChoiceValue2, 'Approved');
  const result = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customChoiceColumn: first, customSecondChoiceColumn: second, customFormulaColumn: formula }, fontBytes));
  assert.match(result.text, /Rate: Standard/u);
  assert.match(result.text, /Disposition: Approved/u);
  assert.match(result.text, /Adjusted: 20/u);
});

test('PDF summary prints canonical Number values from the same selected rows as CSV', async () => {
  const number = { version: 1, name: 'Quantity' };
  const annotations = [
    { id: 'one', page: 1, type: 'comment', markupNumberValue: -7.25 },
    { id: 'two', page: 1, type: 'comment', markupNumberValue: -0 },
  ];
  const rows = markupSummaryRows(annotations, [annotations[0]], null, number);
  assert.equal(rows[0].customNumberValue, '-7.25');
  assert.match(markupCsv(annotations, [annotations[0]], '', null, number), /"-7.25"/u);
  const result = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customNumberColumn: number }, fontBytes));
  assert.match(result.text, /Quantity: -7\.25/u);
  assert.doesNotMatch(result.text, /Quantity: 0/u);
});

test('PDF summary renders second Number without changing first Number Formula', async () => {
  const first = { version: 1, name: 'Quantity' };
  const second = { version: 1, name: 'Unit cost' };
  const formula = { version: 1, name: 'Estimate', source: 'customNumber',
    multiplier: '2', offset: '0' };
  const annotations = [{ id: 'a', page: 1, type: 'box', markupNumberValue: -7.25,
    markupNumberValue2: 0.5 }, { id: 'b', page: 1, type: 'box', markupNumberValue2: 99 }];
  const rows = markupSummaryRows(annotations, [annotations[0]], null, first, null, formula,
    null, second);
  assert.equal(rows[0].customNumberValue2, '0.5');
  const result = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customNumberColumn: first, customSecondNumberColumn: second,
    customFormulaColumn: formula, generatedAt: new Date('2026-10-13T20:00:00.000Z') }, fontBytes));
  // A fixed clock keeps the generated timestamp free of the excluded row's "99".
  assert.match(result.text, /Quantity: -7.25/u);
  assert.match(result.text, /Unit cost: 0.5/u);
  assert.match(result.text, /Estimate: -14.5/u);
  assert.doesNotMatch(result.text, /99/u);
});

test('PDF summary renders normalized Checkmark states and selected scope', async () => {
  const checkmark = { version: 1, name: 'Verified' };
  const annotations = [
    { id: 'blank', page: 1, type: 'square' },
    { id: 'unchecked', page: 1, type: 'square', markupCheckmarkValue: 'unchecked' },
    { id: 'checked', page: 1, type: 'square', markupCheckmarkValue: 'checked' },
  ];
  const rows = markupSummaryRows(annotations, null, null, null, checkmark);
  assert.deepEqual(rows.map(row => row.customCheckmarkValue), [null, 'unchecked', 'checked']);
  const all = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customCheckmarkColumn: checkmark }, fontBytes));
  assert.match(all.text, /Verified: Unchecked/u);
  assert.match(all.text, /Verified: Checked/u);
  const selectedRows = markupSummaryRows(annotations, [annotations[1]], null, null, checkmark);
  const selected = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows: selectedRows,
    customCheckmarkColumn: checkmark }, fontBytes));
  assert.match(selected.text, /Verified: Unchecked/u);
  assert.doesNotMatch(selected.text, /Verified: Checked/u);
});

test('PDF summary prints the computed Formula value from selected Number rows', async () => {
  const number = { version: 1, name: 'Quantity' };
  const formula = { version: 1, name: 'Estimate', source: 'customNumber', multiplier: '12.5', offset: '2' };
  const annotations = [{ id: 'one', page: 2, type: 'box', markupNumberValue: -7.25 },
    { id: 'two', page: 2, type: 'box', markupNumberValue: 5 }];
  const rows = markupSummaryRows(annotations, [annotations[0]], null, number, null, formula);
  assert.equal(rows[0].customFormulaValue, '-88.625');
  const report = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customNumberColumn: number, customFormulaColumn: formula }, fontBytes));
  assert.match(report.text, /Estimate: -88\.625/u);
  assert.doesNotMatch(report.text, /Estimate: 64\.5/u);
});

test('PDF summary retains the exact sixth decimal for large Formula inputs', async () => {
  const number = { version: 1, name: 'Quantity' };
  const formula = { version: 1, name: 'Estimate', source: 'customNumber',
    multiplier: '-0.893054', offset: '0.199466' };
  const rows = markupSummaryRows([{ id: 'one', page: 2, type: 'box',
    markupNumberValue: '-620399897.661694' }], null, null, number, null, formula);
  assert.equal(rows[0].customFormulaValue, '554050610.405832');
  const report = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customNumberColumn: number, customFormulaColumn: formula }, fontBytes));
  assert.match(report.text, /Estimate: 554050610\.405832/u);
});

test('PDF summary renders Choice labels and their optional numeric Formula results', async () => {
  const choice = { version: 2, name: 'Rate', options: ['Standard', 'Unpriced'],
    numericValues: ['12.5', null] };
  const formula = { version: 2, name: 'Adjusted rate', source: 'customChoice',
    multiplier: '2', offset: '0.199466' };
  const annotations = [{ id: 'one', page: 2, type: 'box', markupChoiceValue: 'Standard' },
    { id: 'two', page: 2, type: 'box', markupChoiceValue: 'Unpriced' }];
  const rows = markupSummaryRows(annotations, null, choice, null, null, formula);
  assert.deepEqual(rows.map(row => row.customFormulaValue), ['25.199466', '']);
  const report = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customChoiceColumn: choice, customFormulaColumn: formula }, fontBytes));
  assert.match(report.text, /Rate: Standard/u);
  assert.match(report.text, /Adjusted rate: 25\.199466/u);
  assert.match(report.text, /Rate: Unpriced/u);
});

test('PDF summary uses second Number for version 3 Formula', async () => {
  const first = { version: 1, name: 'Quantity' };
  const second = { version: 1, name: 'Unit cost' };
  const formula = { version: 3, name: 'Extended cost', source: 'customNumber2',
    multiplier: '-0.893054', offset: '0.199466' };
  const rows = markupSummaryRows([{ id: 'one', page: 2, type: 'box', markupNumberValue: 7,
    markupNumberValue2: '-620399897.661694' }], null, null, first, null, formula, null, second);
  assert.equal(rows[0].customFormulaValue, '554050610.405832');
  const report = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows,
    customNumberColumn: first, customSecondNumberColumn: second, customFormulaColumn: formula }, fontBytes));
  assert.match(report.text, /Quantity: 7/u);
  assert.match(report.text, /Unit cost: -620399897\.661694/u);
  assert.match(report.text, /Extended cost: 554050610\.405832/u);
});

test('markup PDF lists a thread as indented reply lines, oldest first', async () => {
  const rows = markupSummaryRows([{ id: 'one', page: 1, type: 'box', author: 'Ann', replies: [
    { id: 'b', author: 'Bo', text: 'Second answer', createdAt: '2026-10-02T00:00:00.000Z' },
    { id: 'a', author: 'Cy', text: 'First answer', createdAt: '2026-10-01T00:00:00.000Z' }] }]);
  assert.deepEqual(rows[0].replyRows.map(reply => reply.author), ['Cy', 'Bo']);
  const report = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', rows }, fontBytes));
  assert.match(report.text, /Replies: Cy: First answer \(2026-10-01T00:00:00.000Z\) Bo: Second answer/u);
});

test('markup PDF prints the status history, or only the latest status when asked', async () => {
  const markup = { id: 'one', page: 1, type: 'box', author: 'Ann', status: 'completed', statusHistory: [
    { state: 'accepted', author: 'Bo', date: '2026-10-01T00:00:00.000Z' },
    { state: 'completed', author: 'Cy', date: '2026-10-02T00:00:00.000Z' }] };
  const all = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', showStatusHistory: true,
    rows: markupSummaryRows([markup]) }, fontBytes));
  assert.match(all.text, /Status history: Accepted by Bo \(2026-10-01T00:00:00.000Z\) Completed by Cy/u);
  const latest = await reopen(await buildMarkupSummaryPdf({ sourcePath: 'plan.pdf', showStatusHistory: true,
    latestStatusOnly: true, rows: markupSummaryRows([markup], null, null, null, null, null, null, null,
      { latestStatusOnly: true }) }, fontBytes));
  assert.match(latest.text, /Latest status: Completed by Cy/u);
  assert.doesNotMatch(latest.text, /Accepted by Bo/u);
});
