import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
fixture.addPage([612, 792]);
const bytes = Array.from(await fixture.save());
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    for (const name of ['issued.pdf', 'revised.pdf']) {
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(content));
    }
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const [oldDoc, newDoc] = state.documents.filter(doc => doc?.filePath && doc?.pdfDoc).slice(-2);
    compare.startCompare({ oldFilePath: oldDoc.filePath, newFilePath: newDoc.filePath, mode: 'side' });
    compare.confirmCurrentPagePair();
    compare.setPagePair(2, 2);
    compare.confirmCurrentPagePair();
    compare.setCompareOffset({ dx: 4, dy: -1, rotation: 0 });
  }, bytes);
  await page.locator('.compare-batch button').filter({ hasText: 'Compare confirmed pairs' }).click();
  await page.getByText('2 pairs complete').waitFor({ timeout: 15000 });

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export batch PDF' }).click();
  const pdf = await pdfDownload;
  assert.match(pdf.suggestedFilename(), /-batch-changes\.pdf$/u);
  const pdfBytes = await readFile(await pdf.path());
  const task = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false });
  const reader = await task.promise;
  const text = (await (await reader.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(text, /BATCH COMPARISON REPORT/u);
  assert.match(text, /issued\.pdf/u);
  assert.match(text, /revised\.pdf/u);
  assert.match(text, /2 total; 2 completed; 0 failed; 0 not processed/u);
  assert.match(text, /Pair 1 - old page 1 \/ new page 1/u);
  assert.match(text, /Pair 2 - old page 2 \/ new page 2/u);
  assert.match(text, /Page pairing: confirmed manually/u);
  assert.match(text, /COMPLETED DETECTION - 0 changes found\. Review state: UNREVIEWED/u);
  await task.destroy();

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export batch CSV' }).click();
  const csv = (await readFile(await (await csvDownload).path())).toString('utf8');
  assert.match(csv, /confirmed manually/u);
  assert.match(csv, /completed/u);
  assert.deepEqual(errors, []);
  console.log('Batch PDF report smoke passed: browser PDF/CSV exports and reopened PDF text');
} finally {
  await browser?.close();
  await server?.close();
}
