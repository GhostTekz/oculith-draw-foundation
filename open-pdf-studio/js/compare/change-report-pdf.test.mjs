import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildCompareChangeReportPdf } from './change-report-pdf.js';
import { suggestedComparePdfReportName } from './change-report.js';

const fontBytes = await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));

async function reopen(bytes) {
  const document = await PDFDocument.load(bytes);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const reader = await task.promise;
  const pages = [];
  for (let index = 1; index <= reader.numPages; index++) {
    const text = await (await reader.getPage(index)).getTextContent();
    pages.push(text.items.map(item => item.str).join(' '));
  }
  await task.destroy();
  return { document, text: pages.join(' '), pages };
}

test('PDF report reopens with sources, confirmed pairing, alignment, changes, and unreviewed state', async () => {
  const bytes = await buildCompareChangeReportPdf({
    oldPath: '/plans/Résumé old.pdf', newPath: '/plans/旧 revision.pdf',
    oldPage: 2, newPage: 4, offset: { dx: -12, dy: 5, rotation: 2 },
    pairing: { oldPage: 2, newPage: 4, source: 'manual', confirmedAt: '2026-10-13T19:00:00.000Z' },
    generatedAt: new Date('2026-10-13T20:00:00.000Z'),
    changes: [
      { type: 'added', x: 50, y: 20, width: 10, height: 6, detectScale: 0.8, pixelCount: 46 },
      { type: 'modified', source: 'annotation', label: 'Révision 旧', x: 7, y: 8, width: 9, height: 10 },
    ],
  }, fontBytes);
  const result = await reopen(bytes);
  assert.equal(result.document.getPageCount(), 1);
  assert.match(result.text, /UNREVIEWED/);
  assert.match(result.text, /Résumé old\.pdf/u);
  assert.match(result.text, /\[U\+65E7\] revision\.pdf/u);
  assert.match(result.text, /Old source - page 2/u);
  assert.match(result.text, /New source - page 4/u);
  assert.match(result.text, /Page pairing: confirmed manually at 2026-10-13T19:00:00\.000Z/u);
  assert.match(result.text, /dx -12 display px; dy 5 display px; rotation 2 deg/u);
  assert.match(result.text, /Detected changes: 2/u);
  assert.match(result.text, /Change 1 - ADDED \(visual\)/u);
  assert.match(result.text, /Change 2 - MODIFIED \(annotation\)/u);
  assert.match(result.text, /Description: Révision \[U\+65E7\]/u);
  assert.match(result.text, /detection pixels/u);
  assert.match(result.text, /page-view units/u);
  assert.match(result.text, /Page-view bounds \(aligned new page\): x 62\.5, y 25, width 12\.5, height 7\.5/u);
  assert.match(result.text, /Page-view bounds \(new page\): x 7, y 8, width 9, height 10/u);
  assert.match(result.text, /CSV report retains the original text/u);
  assert.equal(suggestedComparePdfReportName('old.pdf', 'new.pdf', 2, 4), 'old-p2_vs_new-p4-changes.pdf');
});

test('zero-change PDF states detection and review separately, without false confirmation', async () => {
  const bytes = await buildCompareChangeReportPdf({
    oldPath: 'old.pdf', newPath: 'new.pdf', oldPage: 1, newPage: 3,
    offset: { dx: 0, dy: 0, rotation: 0 }, changes: [],
    pairing: { oldPage: 1, newPage: 2, source: 'manual' },
    generatedAt: new Date('2026-10-13T20:00:00.000Z'),
  }, fontBytes);
  const result = await reopen(bytes);
  assert.match(result.text, /Page pairing: unconfirmed/u);
  assert.match(result.text, /Detected changes: 0/u);
  assert.match(result.text, /No changes detected for this page pair\. Review state: UNREVIEWED/u);
});

test('long change lists paginate and retain their final change', async () => {
  const changes = Array.from({ length: 65 }, (_, index) => ({
    type: 'modified', source: 'annotation', label: `Door ${index + 1}`, x: index, y: 2, width: 3, height: 4,
  }));
  const bytes = await buildCompareChangeReportPdf({
    oldPath: 'old.pdf', newPath: 'new.pdf', oldPage: 1, newPage: 1,
    changes, generatedAt: new Date('2026-10-13T20:00:00.000Z'),
  }, fontBytes);
  const result = await reopen(bytes);
  assert.ok(result.document.getPageCount() > 1);
  assert.match(result.text, /Change 65 - MODIFIED \(annotation\)/u);
  assert.match(result.pages.at(-1), /Page \d+ of \d+/u);
});
