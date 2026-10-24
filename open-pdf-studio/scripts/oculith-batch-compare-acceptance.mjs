import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer } from 'vite';
import { buildBatchCompareChangeReport } from '../js/compare/change-report.js';
import { buildBatchCompareChangeReportPdf } from '../js/compare/change-report-pdf.js';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-batch-acceptance-'));
const oldPath = join(directory, 'issued.pdf');
const newPath = join(directory, 'revision.pdf');

async function makeSheets(revised) {
  const pdf = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
    const page = pdf.addPage([612, 792]);
    if (revised && pageNumber === 2) {
      page.drawRectangle({ x: 300, y: 230, width: 100, height: 60, color: rgb(0.12, 0.37, 0.65) });
    }
    if (revised && pageNumber === 3) {
      page.drawRectangle({ x: 110, y: 480, width: 80, height: 50, color: rgb(0.12, 0.37, 0.65) });
    }
  }
  return new Uint8Array(await pdf.save());
}

const oldBytes = await makeSheets(false);
const newBytes = await makeSheets(true);
await writeFile(oldPath, oldBytes);
await writeFile(newPath, newBytes);

// Parse the exported CSV as a consumer would; do not use the report model to
// manufacture expected rows from the detector's output.
function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (index === 0 && char === '\ufeff') continue;
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if (char === '\r' && input[index + 1] === '\n' && !quoted) {
      row.push(cell); rows.push(row); row = []; cell = ''; index++;
    } else cell += char;
  }
  assert.equal(quoted, false, 'CSV quote balance');
  assert.equal(cell, '', 'CSV uses complete CRLF records');
  assert.deepEqual(row, []);
  const headers = rows.shift();
  assert.equal(new Set(headers).size, headers.length, 'CSV headers are unique');
  return rows.map(cells => {
    assert.equal(cells.length, headers.length, 'CSV column count');
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
}

async function pdfText(bytes) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  try {
    const reader = await task.promise;
    const pages = [];
    for (let index = 1; index <= reader.numPages; index++) {
      pages.push((await (await reader.getPage(index)).getTextContent()).items.map(item => item.str).join(' '));
    }
    return pages.join(' ');
  } finally { await task.destroy(); }
}

function assertBounds(row, expected) {
  for (const [column, value] of Object.entries(expected)) {
    assert.ok(Math.abs(Number(row[column]) - value) < 1,
      `${column}: expected ${value}, got ${row[column]}`);
  }
}

let server;
let browser;
try {
  const probe = createNetServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  server = await createServer({ cacheDir: join(directory, 'vite-cache'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: { port } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async files => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { cacheWebFile } = await import('/js/core/platform.js');
    for (const file of files) {
      cacheWebFile(file.path, Uint8Array.from(file.bytes));
      const { index } = createTab(file.path);
      await loadPDF(file.path, index, Uint8Array.from(file.bytes));
    }
    const compare = await import('/js/compare/compare-store.js');
    compare.startCompare({ oldFilePath: files[0].path, newFilePath: files[1].path, oldPage: 1, newPage: 3, mode: 'side' });
    compare.confirmCurrentPagePair();
    compare.setPagePair(2, 1);
    compare.confirmCurrentPagePair();
    compare.setPagePair(3, 2);
    compare.confirmCurrentPagePair();
  }, [{ path: oldPath, bytes: Array.from(oldBytes) }, { path: newPath, bytes: Array.from(newBytes) }]);
  await page.locator('.compare-batch button').filter({ hasText: 'Compare confirmed pairs' }).click();
  await page.getByText('3 pairs complete').waitFor({ timeout: 30000 });
  const uiRows = await page.locator('.compare-batch-results tbody tr').allInnerTexts();
  assert.deepEqual(uiRows.map(text => text.replace(/\s+/gu, ' ').trim()), [
    '1 3 1 change Go to pair', '2 1 0 changes Go to pair', '3 2 1 change Go to pair',
  ]);
  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export batch CSV' }).click();
  const csv = await readFile(await (await csvDownload).path(), 'utf8');
  await writeFile(join(directory, 'batch.csv'), csv);
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => [row['Old page'], row['New page'], row['Change number'],
    row['Change type'], row.Source, row['Batch result']]), [
    ['1', '3', '1', 'added', 'visual', 'completed'],
    ['2', '1', '', 'none', '', 'completed'],
    ['3', '2', '1', 'added', 'visual', 'completed'],
  ]);
  for (const row of rows) {
    assert.equal(row['Page pairing status'], 'confirmed manually');
    assert.match(row['Old document'], /issued\.pdf$/u);
    assert.match(row['New document'], /revision\.pdf$/u);
  }
  assertBounds(rows[0], { 'Page-view X': 110, 'Page-view Y': 262,
    'Page-view width': 80, 'Page-view height': 50 });
  assertBounds(rows[2], { 'Page-view X': 300, 'Page-view Y': 502,
    'Page-view width': 100, 'Page-view height': 60 });
  assert.equal(rows[1]['Page-view frame'], '');
  assert.deepEqual(rows.map(row => row.Error), ['', '', '']);

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export batch PDF' }).click();
  const reportBytes = new Uint8Array(await readFile(await (await pdfDownload).path()));
  await writeFile(join(directory, 'batch.pdf'), reportBytes);
  const report = await pdfText(reportBytes);
  assert.match(report, /BATCH COMPARISON REPORT/u);
  assert.match(report, /Pairs: 3 total; 3 completed; 0 failed; 0 not processed/u);
  assert.match(report, /Detected changes in completed pairs: 2/u);
  const sections = report.split(/Pair \d+ - old page \d+ \/ new page \d+/u);
  const pairHeaders = [...report.matchAll(/Pair (\d+) - old page (\d+) \/ new page (\d+)/gu)]
    .map(match => match.slice(1));
  assert.deepEqual(pairHeaders, [['1', '1', '3'], ['2', '2', '1'], ['3', '3', '2']]);
  assert.equal(sections.length, 4);
  assert.match(sections[1], /COMPLETED DETECTION - 1 change found/u);
  assert.match(sections[1], /Change 1 - ADDED \(visual\)/u);
  assert.match(sections[1], /Page-view bounds \(aligned new page\): x 110, y 262, width 80, height 50/u);
  assert.match(sections[2], /COMPLETED DETECTION - 0 changes found/u);
  assert.match(sections[2], /No changes detected for this pair/u);
  assert.doesNotMatch(sections[2], /Change 1 - /u);
  assert.match(sections[3], /COMPLETED DETECTION - 1 change found/u);
  assert.match(sections[3], /Page-view bounds \(aligned new page\): x 300, y 502, width 100, height 60/u);

  // Exercise an actual render failure in the batch engine. A deterministic
  // injected error on pair 3 stands in for a failed raster; pairs 1 and 2
  // still use the real PDF detector. Parse both report formats independently.
  const failedBatch = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    const { detectComparePair } = await import('/js/compare/compare-viewport.js');
    const { runConfirmedPairBatch } = await import('/js/compare/batch-compare.js');
    return runConfirmedPairBatch({
      oldPath: compare.compareOldPath(), newPath: compare.compareNewPath(),
      pairs: compare.compareConfirmedPairs(), offset: compare.compareOffset(),
      detectPair: options => options.oldPage === 3
        ? Promise.reject(new Error('Injected page 3 raster failure')) : detectComparePair(options),
    });
  });
  assert.equal(failedBatch.completed, 3);
  assert.equal(failedBatch.failures.length, 1);
  const failedRows = parseCsv(buildBatchCompareChangeReport(failedBatch));
  assert.deepEqual(failedRows.map(row => [row['Old page'], row['New page'], row['Change type'], row['Batch result']]), [
    ['1', '3', 'added', 'completed'], ['2', '1', 'none', 'completed'], ['3', '2', '', 'failed'],
  ]);
  assert.equal(failedRows[1].Error, '');
  assert.equal(failedRows[2].Error, 'Injected page 3 raster failure');
  assert.equal(failedRows[2]['Change number'], '');
  assert.equal(failedRows[2]['Page-view X'], '');
  const fontBytes = await readFile(new URL('../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
  const failedPdf = await pdfText(await buildBatchCompareChangeReportPdf(failedBatch, fontBytes));
  assert.match(failedPdf, /Pairs: 3 total; 2 completed; 1 failed; 0 not processed/u);
  assert.match(failedPdf, /Detected changes in completed pairs: 1/u);
  const failedSections = failedPdf.split(/Pair \d+ - old page \d+ \/ new page \d+/u);
  assert.equal(failedSections.length, 4);
  assert.match(failedSections[2], /COMPLETED DETECTION - 0 changes found/u);
  assert.match(failedSections[3], /FAILED - Detection did not complete; no zero-change conclusion/u);
  assert.match(failedSections[3], /Error: Injected page 3 raster failure/u);
  assert.doesNotMatch(failedSections[3], /No changes detected|COMPLETED DETECTION/u);

  await page.locator('.compare-batch-results tbody tr').first().getByRole('button', { name: 'Go to pair' }).click();
  await page.waitForFunction(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return compare.compareOldPage() === 1 && compare.compareNewPage() === 3
      && !compare.compareDetecting() && compare.compareChanges().length === 1;
  }, null, { timeout: 30000 });
  const markedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all detected regions on this pair' }).click();
  const markedBytes = new Uint8Array(await readFile(await (await markedDownload).path()));
  await writeFile(join(directory, 'revision-marked.pdf'), markedBytes);
  const markedTask = getDocument({ data: markedBytes.slice(), useSystemFonts: false });
  const markedReader = await markedTask.promise;
  assert.equal(markedReader.numPages, 3);
  assert.equal((await (await markedReader.getPage(2)).getAnnotations()).length, 0);
  const markups = await (await markedReader.getPage(3)).getAnnotations();
  assert.equal(markups.length, 1);
  assert.equal(markups[0].subtype, 'Square');
  assert.deepEqual(markups[0].rect, [110, 480, 190, 530]);
  assert.match(markups[0].contentsObj.str, /Old source: .*issued\.pdf — page 1/u);
  assert.match(markups[0].contentsObj.str, /New source: .*revision\.pdf — page 3/u);
  assert.equal(markups[0].annotationFlags & (64 | 128), 0, 'revision markup stays editable');
  await markedTask.destroy();

  // Reopen the exported PDF in the editor and save again. The editable Square
  // and its source provenance must survive the app's normal save pipeline.
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('revision-marked.pdf');
    await loadPDF('revision-marked.pdf', index, Uint8Array.from(bytes));
  }, Array.from(markedBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?._annotationPagesReady?.size === 3);
  const resavedDownload = page.waitForEvent('download');
  assert.equal(await page.evaluate(async () => {
    const { savePDF } = await import('/js/pdf/saver.js');
    return savePDF('revision-resaved.pdf', { zonderHandtekeningVraag: true });
  }), true);
  const resavedBytes = new Uint8Array(await readFile(await (await resavedDownload).path()));
  await writeFile(join(directory, 'revision-resaved.pdf'), resavedBytes);
  const resavedTask = getDocument({ data: resavedBytes.slice(), useSystemFonts: false });
  const resavedReader = await resavedTask.promise;
  const resavedMarkups = await (await resavedReader.getPage(3)).getAnnotations();
  assert.equal(resavedMarkups.length, 1, 'revision region survives app save without duplication');
  assert.deepEqual(resavedMarkups[0].rect, [110, 480, 190, 530]);
  assert.equal(resavedMarkups[0].annotationFlags & (64 | 128), 0);
  assert.match(resavedMarkups[0].contentsObj.str, /Old source: .*issued\.pdf — page 1/u);
  await resavedTask.destroy();
  assert.deepEqual(errors, []);
  console.log('Batch acceptance passed: 3 remapped sheets, 2 exact visual changes, zero-change versus failed pair, independent CSV/PDF parsing, editable markup save/reopen');
} finally {
  await browser?.close();
  await server?.close();
  if (!process.env.OCUDRAW_KEEP_ACCEPTANCE_ARTIFACTS) await rm(directory, { recursive: true, force: true });
  else console.log(`Acceptance artifacts: ${directory}`);
}
