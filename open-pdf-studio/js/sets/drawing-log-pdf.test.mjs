import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildDrawingLogPdf } from './drawing-log-pdf.js';

const font = await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

async function reopen(bytes) {
  const parsed = await PDFDocument.load(bytes);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const reader = await task.promise;
  const pages = [];
  for (let number = 1; number <= reader.numPages; number++) {
    pages.push((await (await reader.getPage(number)).getTextContent()).items.map(item => item.str).join(' '));
  }
  await task.destroy();
  return { parsed, pages, text: pages.join(' ') };
}

test('drawing log PDF reopens with stable IDs, current and historical sources, and honest status', async () => {
  const register = { name: 'Étage 旧 drawings', sheets: [{
    id: 'stable-a101', label: 'A-101', title: 'Lobby', revision: 'B', page: 3,
    filePath: '/plans/revised.pdf', history: [{
      revision: 'A', page: 1, filePath: '/plans/old.pdf', replacedAt: '2026-10-13T10:00:00Z',
    }],
  }] };
  const bytes = await buildDrawingLogPdf(register, { 'stable-a101': 'Present' }, font, new Date('2026-10-13T20:00:00Z'));
  const report = await reopen(bytes);
  assert.equal(report.parsed.getPageCount(), 1);
  assert.match(report.text, /Étage \[U\+65E7\] drawings/u);
  assert.match(report.text, /Stable sheet ID: stable-a101/u);
  assert.match(report.text, /Current \| Revision B \| Page 3 \| File status: Present/u);
  assert.match(report.text, /PDF: \/plans\/revised\.pdf/u);
  assert.match(report.text, /Earlier \| Revision A \| Page 1/u);
  assert.match(report.text, /PDF: \/plans\/old\.pdf/u);
  assert.match(report.text, /Historical file status: not checked/u);
  assert.match(report.text, /CSV log retains the original text/u);
});

test('long drawing logs paginate and retain the final sheet', async () => {
  const register = { name: 'Large set', sheets: Array.from({ length: 60 }, (_, index) => ({
    id: `sheet-${index + 1}`, label: `A-${index + 1}`, title: `Floor ${index + 1}`,
    revision: 'C', page: index + 1, filePath: '/plans/set.pdf', history: [],
  })) };
  const report = await reopen(await buildDrawingLogPdf(register, {}, font, new Date('2026-10-13T20:00:00Z')));
  assert.ok(report.parsed.getPageCount() > 1);
  assert.match(report.text, /A-60 - Floor 60/u);
  assert.match(report.pages.at(-1), /Page \d+ of \d+/u);
});
