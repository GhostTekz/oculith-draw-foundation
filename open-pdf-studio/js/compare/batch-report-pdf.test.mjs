import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildBatchCompareChangeReportPdf } from './change-report-pdf.js';
import { createBatchCompareReportModel, suggestedBatchComparePdfReportName } from './change-report.js';

const fontBytes = await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
const pair = (oldPage, newPage) => ({ oldPage, newPage, source: 'manual', confirmedAt: '2026-10-13T19:00:00.000Z' });

async function reopen(bytes) {
  const document = await PDFDocument.load(bytes);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const reader = await task.promise;
  const pages = [];
  for (let index = 1; index <= reader.numPages; index++) {
    pages.push((await (await reader.getPage(index)).getTextContent()).items.map(item => item.str).join(' '));
  }
  await task.destroy();
  return { document, pages, text: pages.join(' ') };
}

test('batch PDF reopens with distinct changed, zero-change, failed, and unprocessed pairs', async () => {
  const pairs = [pair(2, 7), pair(4, 9), pair(6, 11), pair(8, 13)];
  const batch = {
    oldPath: '/plans/Résumé issued.pdf', newPath: '/plans/旧 revised.pdf',
    offset: { dx: 8, dy: -3, rotation: 1 }, pairs,
    results: [
      { pair: pairs[0], changes: [
        { type: 'added', x: 12, y: 8, width: 9, height: 7, pixelCount: 63, detectScale: 1 },
        { type: 'modified', source: 'annotation', label: 'Révision 旧', x: 4, y: 5, width: 6, height: 7 },
      ] },
      { pair: pairs[1], changes: [] },
    ],
    failures: [{ pair: pairs[2], error: 'Raster render 旧 failed' }],
    completed: 3, canceled: true, completedAt: '2026-10-13T20:00:00.000Z',
  };
  assert.deepEqual(createBatchCompareReportModel(batch).pairs.map(item => item.status),
    ['completed', 'completed', 'failed', 'unprocessed']);
  const result = await reopen(await buildBatchCompareChangeReportPdf(batch, fontBytes));
  assert.ok(result.document.getPageCount() >= 1);
  assert.match(result.text, /Résumé issued\.pdf/u);
  assert.match(result.text, /\[U\+65E7\] revised\.pdf/u);
  assert.match(result.text, /dx 8 display px; dy -3 display px; rotation 1 deg/u);
  assert.match(result.text, /4 total; 2 completed; 1 failed; 1 not processed/u);
  assert.match(result.text, /Detected changes in completed pairs: 2/u);
  assert.match(result.text, /Pair 1 - old page 2 \/ new page 7/u);
  assert.match(result.text, /Page pairing: confirmed manually at 2026-10-13T19:00:00\.000Z/u);
  assert.match(result.text, /COMPLETED DETECTION - 2 changes found\. Review state: UNREVIEWED/u);
  assert.match(result.text, /Description: Révision \[U\+65E7\]/u);
  assert.match(result.text, /Page-view bounds \(aligned new page\): x 12, y 8, width 9, height 7/u);
  assert.match(result.text, /Pair 2 - old page 4 \/ new page 9/u);
  assert.match(result.text, /COMPLETED DETECTION - 0 changes found\. Review state: UNREVIEWED/u);
  assert.match(result.text, /No changes detected for this pair/u);
  assert.match(result.text, /Pair 3 - old page 6 \/ new page 11/u);
  assert.match(result.text, /FAILED - Detection did not complete; no zero-change conclusion/u);
  assert.match(result.text, /Error: Raster render \[U\+65E7\] failed/u);
  assert.match(result.text, /Pair 4 - old page 8 \/ new page 13/u);
  assert.match(result.text, /NOT PROCESSED - No detection result\. Review state: UNREVIEWED/u);
  assert.equal(suggestedBatchComparePdfReportName('old.pdf', 'new.pdf'), 'old-pall_vs_new-pall-batch-changes.pdf');
});

test('batch PDF paginates many confirmed pairs and preserves the final result', async () => {
  const pairs = Array.from({ length: 35 }, (_, index) => pair(index + 1, index + 51));
  const batch = {
    oldPath: 'old.pdf', newPath: 'new.pdf', offset: { dx: 0, dy: 0, rotation: 0 },
    pairs, results: pairs.map(pair => ({ pair, changes: [] })), failures: [],
    completed: pairs.length, canceled: false, completedAt: '2026-10-13T20:00:00.000Z',
  };
  const result = await reopen(await buildBatchCompareChangeReportPdf(batch, fontBytes));
  assert.ok(result.document.getPageCount() > 1);
  assert.match(result.text, /Pair 35 - old page 35 \/ new page 85/u);
  assert.match(result.pages.at(-1), /Page \d+ of \d+/u);
});

test('batch model preserves unconfirmed provenance instead of claiming manual review', () => {
  const stale = { ...pair(1, 3), source: 'suggested' };
  const model = createBatchCompareReportModel({
    oldPath: 'old.pdf', newPath: 'new.pdf', pairs: [stale],
    results: [{ pair: stale, changes: [] }], failures: [], completedAt: '2026-10-13T20:00:00.000Z',
  });
  assert.equal(model.pairs[0].report.pairingStatus, 'unconfirmed');
});
