import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-batch-results-'));
const paths = [join(directory, 'issued.pdf'), join(directory, 'revised.pdf')];
for (const path of paths) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  await writeFile(path, await pdf.save());
}

let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const files = await Promise.all(paths.map(async path => ({ name: path.split('/').pop(), bytes: Array.from(await readFile(path)) })));
  await page.evaluate(async filesToOpen => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    for (const file of filesToOpen) {
      const { index } = createTab(file.name);
      await loadPDF(file.name, index, Uint8Array.from(file.bytes));
    }
  }, files);
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const [oldDoc, newDoc] = state.documents.filter(doc => doc?.filePath && doc?.pdfDoc).slice(-2);
    compare.startCompare({ oldFilePath: oldDoc.filePath, newFilePath: newDoc.filePath, mode: 'side' });
    compare.confirmCurrentPagePair();
    compare.setPagePair(2, 2);
    compare.confirmCurrentPagePair();
  });
  await page.locator('.compare-batch button').filter({ hasText: 'Compare confirmed pairs' }).click();
  await page.locator('.compare-batch-results tbody tr').first().waitFor();
  try {
    await page.getByText('2 pairs complete').waitFor({ timeout: 10000 });
  } catch (error) {
    console.error('Batch status:', await page.locator('.compare-batch').innerText());
    console.error('Results:', await page.locator('.compare-batch-results').innerText());
    console.error('Page errors:', errors);
    throw error;
  }
  const rows = page.locator('.compare-batch-results tbody tr');
  assert.equal(await rows.count(), 2);
  assert.match(await rows.first().innerText(), /0 changes/);
  assert.match(await rows.last().innerText(), /0 changes/);
  await rows.first().getByRole('button', { name: 'Go to pair' }).click();
  const current = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return [compare.compareOldPage(), compare.compareNewPage()];
  });
  assert.deepEqual(current, [1, 1]);
  assert.deepEqual(errors, []);
  console.log('Batch results smoke passed: two confirmed pairs, zero-change rows, jump to pair');
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
