import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
for (let index = 0; index < 12; index++) fixture.addPage([612, 792]);
const bytes = Array.from(await fixture.save());
// Vite normalizes server.port: 0 to its default port. Ask the OS for an
// ephemeral port first, then use it for both HTTP and HMR.
const probe = createNetServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: { port } }, logLevel: 'error' });
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
    for (let number = 1; number <= 12; number++) {
      compare.setPagePair(number, number);
      compare.confirmCurrentPagePair();
    }
  }, bytes);
  await page.getByRole('button', { name: 'Compare confirmed pairs' }).click();
  await page.locator('.compare-batch-results tbody tr').first().getByText('0 changes').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Stop after current pair' }).click();
  await page.getByText(/Stopped after \d+ of 12 pairs · partial results/u).waitFor({ timeout: 20000 });

  const rows = page.locator('.compare-batch-results tbody tr');
  assert.equal(await rows.count(), 12);
  const outcomes = await rows.locator('td:nth-child(3)').allTextContents();
  assert.ok(outcomes.includes('0 changes'));
  assert.ok(outcomes.includes('Not processed'));
  assert.match(await page.locator('.compare-batch-results summary').innerText(), /not processed/u);

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export batch CSV' }).click();
  const csv = (await readFile(await (await csvDownload).path())).toString('utf8');
  assert.match(csv, /confirmed manually/u);
  assert.match(csv, /,none,,unreviewed,/u);
  assert.match(csv, /,unprocessed,\r\n/u);

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export batch PDF' }).click();
  const pdfBytes = await readFile(await (await pdfDownload).path());
  const task = getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false });
  const reader = await task.promise;
  const pages = [];
  for (let number = 1; number <= reader.numPages; number++) {
    const content = await (await reader.getPage(number)).getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  const text = pages.join(' ');
  assert.match(text, /Batch stopped before every pair completed/u);
  assert.match(text, /COMPLETED DETECTION - 0 changes found/u);
  assert.match(text, /NOT PROCESSED - No detection result/u);
  assert.deepEqual(errors, []);
  await task.destroy();
  console.log('Canceled batch smoke passed: partial UI, CSV, and reopened PDF');
} finally {
  await browser?.close();
  await server?.close();
}
