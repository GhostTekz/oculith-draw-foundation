import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-set-navigation-'));

async function makePdf(name, pages) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) pdf.addPage([612, 792]);
  const path = join(directory, name);
  await writeFile(path, await pdf.save());
  return path;
}

const twoPath = await makePdf('two.pdf', 2);
const tenPath = await makePdf('ten.pdf', 1);
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify({
    version: 1, name: 'Navigation set', sheets: [
      { id: 'ten', label: 'A-10', title: 'Ten', revision: 'C', filePath: 'ten.pdf', page: 1, history: [] },
      { id: 'missing', label: 'A-3', title: 'Missing', revision: 'B', filePath: 'missing.pdf', page: 1, history: [] },
      { id: 'two', label: 'A-2', title: 'Two', revision: 'B', filePath: 'two.pdf', page: 2, history: [] },
      { id: 'one', label: 'A-1', title: 'One', revision: 'B', filePath: 'two.pdf', page: 1, history: [] },
    ],
  })));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('#left-panel .left-panel-tab[data-panel="sheets"]').click();
  const rows = page.locator('#sheets-panel .sheets-row');
  assert.deepEqual(await rows.locator('strong').allInnerTexts(), ['A-1', 'A-2', 'A-3', 'A-10']);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add PDFs' }).click();
  await (await chooser).setFiles([twoPath, tenPath]);
  await page.getByRole('status').waitFor();
  assert.equal(await rows.count(), 4);

  async function activeDocument() {
    return page.evaluate(async () => {
      const { state } = await import('/js/core/state.ts');
      const doc = state.documents[state.activeDocumentIndex];
      return doc ? { filePath: doc.filePath, page: doc.currentPage, viewMode: doc.viewMode } : null;
    });
  }

  const next = page.getByRole('button', { name: 'Next sheet' });
  await next.click();
  await page.locator('#sheets-panel .sheets-navigation[aria-busy="true"]').waitFor();
  await page.locator('#sheets-panel .sheets-navigation[aria-busy="false"]').waitFor();
  assert.deepEqual(await activeDocument(), { filePath: 'two.pdf', page: 1, viewMode: 'single' });
  await next.focus();
  assert.equal(await next.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#sheets-panel .sheets-row.selected strong')?.textContent === 'A-2');
  await page.locator('#sheets-panel .sheets-navigation[aria-busy="false"]').waitFor();
  assert.deepEqual(await activeDocument(), { filePath: 'two.pdf', page: 2, viewMode: 'single' });
  const previous = page.getByRole('button', { name: 'Previous sheet' });
  await previous.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#sheets-panel .sheets-row.selected strong')?.textContent === 'A-1');
  await page.locator('#sheets-panel .sheets-navigation[aria-busy="false"]').waitFor();
  assert.deepEqual(await activeDocument(), { filePath: 'two.pdf', page: 1, viewMode: 'single' });
  await next.click();
  await page.waitForFunction(() => document.querySelector('#sheets-panel .sheets-row.selected strong')?.textContent === 'A-2');
  await page.locator('#sheets-panel .sheets-navigation[aria-busy="false"]').waitFor();
  assert.deepEqual(await activeDocument(), { filePath: 'two.pdf', page: 2, viewMode: 'single' });
  await next.click();
  await page.getByRole('status').getByText(/Cannot open A-3: PDF unavailable/).waitFor();
  assert.deepEqual(await activeDocument(), { filePath: 'two.pdf', page: 2, viewMode: 'single' });
  assert.match(await page.locator('#sheets-panel .sheets-row.selected').innerText(), /A-3/);
  await next.click();
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.ts');
    return state.documents[state.activeDocumentIndex]?.filePath === 'ten.pdf';
  });
  assert.deepEqual(await activeDocument(), { filePath: 'ten.pdf', page: 1, viewMode: 'single' });
  assert.equal(await next.isDisabled(), true);
  await rows.nth(3).focus();
  await page.keyboard.press('Home');
  assert.equal(await rows.first().getAttribute('aria-pressed'), 'true');
  assert.equal(await rows.first().evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await rows.nth(1).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('End');
  assert.equal(await rows.nth(3).getAttribute('aria-pressed'), 'true');
  assert.equal(await rows.nth(3).evaluate(el => document.activeElement === el), true);
  assert.deepEqual(await activeDocument(), { filePath: 'ten.pdf', page: 1, viewMode: 'single' },
    'list browsing does not open another PDF until the user chooses Open sheet');
  const manifest = await page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  assert.deepEqual(manifest.sheets.map(sheet => sheet.label), ['A-10', 'A-3', 'A-2', 'A-1']);
  assert.deepEqual(errors, []);
  console.log('Set navigation smoke passed: natural order, keyboard, cross-PDF pages, missing file');
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
