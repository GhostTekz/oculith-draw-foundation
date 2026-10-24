import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-history-navigation-'));

async function makePdf(name, count) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < count; index++) pdf.addPage([612, 792]);
  const path = join(directory, name);
  await writeFile(path, await pdf.save());
  return path;
}

const currentPath = await makePdf('current.pdf', 3);
const oldPath = await makePdf('old.pdf', 2);
const otherPath = await makePdf('other.pdf', 1);
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
    version: 1, name: 'Revision review', sheets: [
      { id: 'stable-a1', label: 'A-1', title: 'Lobby', revision: 'C', filePath: 'current.pdf', page: 3,
        history: [
          { revision: 'A', filePath: 'old.pdf', page: 2, replacedAt: '2026-10-01T00:00:00Z' },
          { revision: 'B', filePath: 'missing.pdf', page: 1, replacedAt: '2026-10-10T00:00:00Z' },
        ] },
      { id: 'stable-m2', label: 'M-2', title: 'Mechanical', revision: '1', filePath: 'other.pdf', page: 1, history: [] },
    ],
  })));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const originalManifest = await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.draw-open-button').click();
  await (await chooser).setFiles([currentPath, oldPath, otherPath]);
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    for (let attempt = 0; attempt < 200; attempt++) {
      if (state.documents.length === 3 && state.documents.every(doc => doc.pdfDoc && !doc._isLoading)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('PDFs did not finish loading');
  });
  await page.locator('#left-panel .left-panel-tab[data-panel="sheets"]').click();
  await page.locator('#sheets-panel .sheets-row').first().click();

  async function active() {
    return page.evaluate(async () => {
      const { state } = await import('/js/core/state.ts');
      const doc = state.documents[state.activeDocumentIndex];
      return { path: doc?.filePath, page: doc?.currentPage };
    });
  }

  await page.getByRole('button', { name: 'Open sheet' }).click();
  await page.locator('#sheets-panel .sheets-navigation[aria-busy="false"]').waitFor();
  assert.deepEqual(await active(), { path: 'current.pdf', page: 3 });
  await page.getByRole('button', { name: 'Open A-1 earlier revision A' }).click();
  await page.getByRole('status').getByText(/Viewing earlier revision A of A-1/).waitFor();
  assert.deepEqual(await active(), { path: 'old.pdf', page: 2 });
  assert.match(await page.getByRole('status').innerText(), /Current source remains revision C/);
  await page.getByRole('button', { name: 'Open A-1 earlier revision B' }).click();
  await page.getByRole('status').getByText(/Cannot open earlier revision B of A-1: PDF unavailable/).waitFor();
  assert.match(await page.getByRole('status').innerText(), /Relink changes only the current revision/);
  assert.match(await page.locator('.sheets-history-item').first().innerText(), /Missing file/);
  assert.deepEqual(await active(), { path: 'old.pdf', page: 2 });
  assert.equal(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1')), originalManifest);

  await page.getByRole('button', { name: 'Next sheet' }).click();
  await page.locator('#sheets-panel .sheets-navigation[aria-busy="false"]').waitFor();
  assert.deepEqual(await active(), { path: 'other.pdf', page: 1 });
  assert.equal(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1')), originalManifest);
  assert.deepEqual(errors, []);
  console.log('History navigation smoke passed: current, prior, missing, unchanged manifest, next sheet');
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
