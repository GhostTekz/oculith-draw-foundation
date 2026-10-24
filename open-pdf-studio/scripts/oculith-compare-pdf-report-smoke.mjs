import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer } from 'vite';

const source = await PDFDocument.create();
source.addPage([612, 792]);
const fixture = Array.from(await source.save());
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
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    for (const name of ['issued.pdf', 'revised.pdf']) {
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(bytes));
    }
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const [oldDoc, newDoc] = state.documents.filter(doc => doc?.filePath && doc?.pdfDoc).slice(-2);
    compare.startCompare({ oldFilePath: oldDoc.filePath, newFilePath: newDoc.filePath, mode: 'side' });
    compare.confirmCurrentPagePair();
    compare.setCompareOffset({ dx: 3, dy: -2, rotation: 0 });
  }, fixture);

  const pdfButton = page.getByRole('button', { name: 'Export change PDF' });
  await pdfButton.waitFor();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === 'Export change PDF')?.disabled);
  const pdfDownload = page.waitForEvent('download');
  await pdfButton.click();
  const pdf = await pdfDownload;
  assert.match(pdf.suggestedFilename(), /-changes\.pdf$/u);
  const bytes = await readFile(await pdf.path());
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const reader = await task.promise;
  const text = (await (await reader.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(text, /issued\.pdf/u);
  assert.match(text, /revised\.pdf/u);
  assert.match(text, /Page pairing: confirmed manually/u);
  assert.match(text, /dx 3 display px; dy -2 display px/u);
  assert.match(text, /Detected changes: 0/u);
  assert.match(text, /UNREVIEWED/u);
  await task.destroy();

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export change CSV' }).click();
  const csv = (await readFile(await (await csvDownload).path())).toString('utf8');
  assert.match(csv, /confirmed manually/u);
  assert.match(csv, /unreviewed/u);
  assert.deepEqual(errors, []);
  console.log('Compare PDF report smoke passed: browser PDF and CSV exports, reopened PDF text');
} finally {
  await browser?.close();
  await server?.close();
}
