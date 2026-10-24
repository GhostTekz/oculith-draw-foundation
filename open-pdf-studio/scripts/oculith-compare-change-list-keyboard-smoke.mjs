import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const pdf = await PDFDocument.create();
pdf.addPage([612, 792]);
const bytes = Array.from(await pdf.save());
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1140, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async input => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    for (const name of ['old-access.pdf', 'new-access.pdf']) {
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(input));
    }
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const [oldDoc, newDoc] = state.documents.filter(doc => doc?.filePath && doc?.pdfDoc).slice(-2);
    compare.startCompare({ oldFilePath: oldDoc.filePath, newFilePath: newDoc.filePath, mode: 'side' });
  }, bytes);
  await page.waitForFunction(async () => !(await import('/js/compare/compare-store.js')).compareDetecting(),
    undefined, { timeout: 15000 });
  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.setChanges([
      ...Array.from({ length: 16 }, (_, index) => ({ type: 'added', x: 20 + index * 4,
        y: 20 + index * 7, width: 20, height: 20 })),
      { type: 'removed', x: 120, y: 160, width: 30, height: 25 },
      { type: 'modified', x: 180, y: 220, width: 35, height: 30 },
    ]);
  });
  const groups = page.locator('.compare-change-group');
  const rows = page.locator('.compare-change-row');
  assert.equal(await groups.count(), 3);
  assert.equal(await rows.count(), 18);
  assert.equal(await groups.first().getAttribute('aria-expanded'), 'true');
  await groups.first().focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await groups.first().getAttribute('aria-expanded'), 'false');
  assert.equal(await rows.count(), 2);
  await page.keyboard.press('ArrowDown');
  assert.equal(await groups.nth(1).evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Home');
  assert.equal(await groups.first().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await groups.first().getAttribute('aria-expanded'), 'true');
  await groups.last().focus();
  await page.keyboard.press('Space');
  assert.equal(await groups.last().getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Space');
  assert.equal(await groups.last().getAttribute('aria-expanded'), 'true');
  await groups.first().focus();
  await page.keyboard.press('End');
  assert.equal(await rows.last().evaluate(element => element === document.activeElement), true);
  assert.equal(await rows.last().evaluate(element => getComputedStyle(element).outlineWidth), '2px',
    'keyboard focus uses the Oculith focus ring');
  assert.ok(await page.locator('.compare-results-scroll').first().evaluate(element => element.scrollTop > 0),
    'End scrolls the final row into view');
  await page.keyboard.press('Enter');
  assert.equal(await rows.last().getAttribute('aria-current'), 'true');
  await rows.first().click();
  assert.equal(await rows.first().getAttribute('aria-current'), 'true');
  await rows.first().click();
  assert.equal(await rows.first().getAttribute('aria-current'), null,
    'pointer click still toggles the selected visual region');

  await page.locator('.compare-panel-tab').last().click();
  await page.waitForFunction(async () => !(await import('/js/compare/compare-store.js')).compareTextComparing());
  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.setCompareTextChanges([
      { source: 'text', type: 'modified', oldPage: 1, newPage: 1,
        oldText: 'Door one', newText: 'Door two', oldRects: [], newRects: [] },
      { source: 'text', type: 'added', newPage: 1,
        oldText: '', newText: 'New note', oldRects: [], newRects: [] },
      { source: 'text', type: 'removed', oldPage: 1,
        oldText: 'Old note', newText: '', oldRects: [], newRects: [] },
    ]);
  });
  const textRows = page.locator('.compare-text-row');
  assert.equal(await textRows.count(), 3);
  await textRows.first().focus();
  await page.keyboard.press('End');
  assert.equal(await textRows.last().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Home');
  assert.equal(await textRows.first().evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await textRows.first().getAttribute('aria-current'), 'true');
  await textRows.last().click();
  assert.equal(await textRows.last().getAttribute('aria-current'), 'true');
  assert.deepEqual(errors, []);
  console.log('Compare change list keyboard smoke passed: groups, visual rows, text rows, selection, scrolling');
} finally {
  await browser?.close();
  await server?.close();
}
