import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-registered-links-'));
async function drawing(pages) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [label, ...references] of pages) {
    const page = pdf.addPage([792, 612]);
    page.drawText(label, { x: 680, y: 40, size: 16, font });
    references.forEach((text, index) => page.drawText(text, { x: 60, y: 500 - index * 40, size: 12, font }));
  }
  const { writePageLabels } = await import('../js/pdf/page-labels.js');
  writePageLabels(pdf, pages.map(page => page[0]));
  const bytes = new Uint8Array(await pdf.save());
  return { bytes, fingerprint: createHash('sha256').update(bytes).digest('hex') };
}
const a = await drawing([
  ['A-101', 'SEE S-201', 'SEE E-101', 'SEE D-301'],
  ['E-101'], ['D-301'],
]);
const s = await drawing([['S-201'], ['D-301']]);
const changed = await drawing([['S-201', 'changed after preview'], ['D-301']]);
const manifest = { version: 1, name: 'Link review', sheets: [
  { id: 'sheet-a101', label: 'A-101', title: 'Plan', revision: 'A', filePath: 'A.pdf', page: 1,
    sourceSha256: a.fingerprint, sourceAliases: [], history: [] },
  { id: 'sheet-s201', label: 'S-201', title: 'Structure', revision: 'A', filePath: 'S.pdf', page: 1,
    sourceSha256: s.fingerprint, sourceAliases: [], history: [] },
] };
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  const downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.addInitScript(value => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify(value)), manifest);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  async function cache(name, bytes) {
    await page.evaluate(async ({ name, bytes }) => {
      (await import('/js/core/platform.js')).cacheWebFile(name, Uint8Array.from(bytes));
    }, { name, bytes: Array.from(bytes) });
  }
  await cache('A.pdf', a.bytes);
  await cache('S.pdf', s.bytes);
  await page.evaluate(async () => (await import('/js/solid/stores/dialogStore.js')).openDialog('set-batch-link'));
  await page.locator('#set-link-registered-targets').check();
  await page.locator('#set-link-find').click();
  const review = page.locator('#set-link-registered-review');
  await review.waitFor();
  const rows = await review.innerText();
  assert.match(rows, /sheet-a101/u);
  assert.match(rows, /S-201 · sheet-s201 · S\.pdf · Page 1/u);
  assert.match(rows, /E-101[\s\S]*Target page label is not registered/u);
  assert.match(rows, /D-301[\s\S]*Ambiguous target/u);
  assert.equal(await page.locator('#set-link-registered-review tbody input[type="checkbox"]').count(), 1);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'))), manifest);
  assert.deepEqual(downloads, [], 'review creates no output');

  await page.evaluate(async () => {
    (await import('/js/solid/stores/sheetRegisterStore.js')).sheetRegister().sheets[1].page = 2;
  });
  await page.locator('#set-link-create').click();
  await page.getByRole('status').filter({ hasText: 'drawing set changed since Find' }).waitFor();
  assert.deepEqual(downloads, [], 'an in-place register edit aborts before any output');
  await page.evaluate(async () => {
    (await import('/js/solid/stores/sheetRegisterStore.js')).sheetRegister().sheets[1].page = 1;
  });

  await page.evaluate(async () => {
    const { saveSheetRegister, sheetRegister } = await import('/js/solid/stores/sheetRegisterStore.js');
    saveSheetRegister({ ...sheetRegister(), sheets: sheetRegister().sheets.map(sheet =>
      sheet.id === 'sheet-s201' ? { ...sheet, page: 2 } : sheet) });
  });
  await page.locator('#set-link-create').click();
  await page.getByRole('status').filter({ hasText: 'drawing set changed since Find' }).waitFor();
  assert.deepEqual(downloads, [], 'a changed register aborts before any output');
  await page.evaluate(async value => {
    (await import('/js/solid/stores/sheetRegisterStore.js')).saveSheetRegister(value);
  }, manifest);
  await page.locator('#set-link-back').click();
  await page.locator('#set-link-find').click();
  await review.waitFor();

  await cache('S.pdf', changed.bytes);
  await page.locator('#set-link-create').click();
  await page.getByRole('status').filter({ hasText: 'changed since Find' }).waitFor();
  assert.deepEqual(downloads, [], 'changed bytes abort before any output');
  await cache('S.pdf', s.bytes);
  await page.locator('#set-link-create').click();
  await page.locator('#set-link-result').waitFor();
  assert.match(await page.locator('#set-link-result').innerText(), /Links created: 1, in 2 files/u);
  assert.deepEqual(downloads.sort(), ['A.pdf', 'S.pdf']);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'))), manifest);
  assert.deepEqual(errors, []);
  console.log('Registered link review passed: stable IDs, unresolved and ambiguous rows, no preview write, changed-byte refusal, explicit linked copies.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
