import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { assertCurrentDrawingLog, createCurrentDrawingLog, currentDrawingLogCsv } from './current-drawing-log.js';
import { buildDrawingLogPdf } from './drawing-log-pdf.js';

const font = await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
const register = { version: 1, name: 'Level one', sheets: [
  { id: 'm201', label: 'M-201', title: 'Plant', revision: 'C', page: 2,
    filePath: '/plans/m.pdf', sourceSha256: 'c'.repeat(64), history: [] },
  { id: 'a102', label: 'A-102', title: 'Room', revision: 'B', page: 2,
    filePath: '/plans/a.pdf', sourceSha256: 'b'.repeat(64), history: [] },
  { id: 'a101', label: 'A-101', title: 'Lobby', revision: 'B', page: 1,
    filePath: '/plans/a.pdf', sourceSha256: 'b'.repeat(64), history: [
      { revision: 'P0', page: 1, filePath: '/plans/old.pdf', replacedAt: '2026-10-13T10:00:00Z' },
    ] },
] };

test('current view CSV preserves natural visible order and omits prior revisions', () => {
  const original = structuredClone(register);
  const view = createCurrentDrawingLog(register, '', 'B');
  assert.deepEqual(view.register.sheets.map(sheet => sheet.label), ['A-101', 'A-102']);
  const csv = currentDrawingLogCsv(view, { a101: 'Present', a102: 'Missing' });
  const rows = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(rows.length, 3);
  assert.match(rows[1], /"a101","A-101","Lobby","Current","B","1","\/plans\/a\.pdf","Present"/u);
  assert.match(rows[2], /"a102","A-102","Room","Current","B","2","\/plans\/a\.pdf","Missing"/u);
  assert.doesNotMatch(csv, /"Prior"|P0|M-201|old\.pdf/u);
  assert.deepEqual(register, original);
  assert.throws(() => createCurrentDrawingLog(register, 'nothing', ''), /No current sheets match/u);
});

test('current view PDF is a real current-only drawing log with visible filter context', async () => {
  const view = createCurrentDrawingLog(register, 'P0', 'B');
  const bytes = await buildDrawingLogPdf(view.register, { a101: 'Present' }, font,
    new Date('2026-10-13T20:00:00Z'), { currentView: view });
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const document = await task.promise;
    assert.equal(document.numPages, 1);
    const text = (await (await document.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    assert.match(text, /CURRENT DRAWING LOG/u);
    assert.match(text, /1 of 3 current sheets in this view/u);
    assert.match(text, /Search: P0 \| Current revision: B/u);
    assert.match(text, /Stable sheet ID: a101/u);
    assert.match(text, /Current \| Revision B \| Page 1 \| File status: Present/u);
    assert.doesNotMatch(text, /Earlier|old\.pdf|A-102|M-201/u);
  } finally { await task.destroy(); }
});

test('export snapshot refuses register, search, or revision changes', () => {
  const source = structuredClone(register);
  const view = createCurrentDrawingLog(source, 'lobby', 'B');
  assert.doesNotThrow(() => assertCurrentDrawingLog(view, source, 'lobby', 'B'));
  assert.throws(() => assertCurrentDrawingLog(view, source, 'room', 'B'), /current view changed/u);
  assert.throws(() => assertCurrentDrawingLog(view, source, 'lobby', 'C'), /current view changed/u);
  source.sheets[2].title = 'Changed';
  assert.throws(() => assertCurrentDrawingLog(view, source, 'lobby', 'B'), /current view changed/u);
});
