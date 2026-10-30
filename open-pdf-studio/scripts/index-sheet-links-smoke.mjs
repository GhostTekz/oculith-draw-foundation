import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-index-links-'));
async function drawing(index = false, changed = false) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1000, 700]);
  if (index) {
    for (const [id, title, y] of [['A-101', 'FIRST FLOOR PLAN', 600],
      ['S-201', 'STRUCTURAL PLAN', 570], ['D-301', 'ROOF PLAN', 540],
      ['D-301', 'PENTHOUSE PLAN', 510], ['X-999', 'UNREGISTERED PLAN', 480]]) {
      page.drawText(id, { x: 50, y, font, size: 12 });
      page.drawText(title, { x: 200, y, font, size: 12 });
    }
    pdf.addPage([1000, 700]).drawText('A-101', { x: 50, y: 600, font, size: 12 });
  } else {
    page.drawText(changed ? 'S-201 REVISED' : 'S-201', { x: 50, y: 600, font, size: 12 });
    pdf.addPage([1000, 700]).drawText('D-301', { x: 50, y: 600, font, size: 12 });
  }
  const bytes = new Uint8Array(await pdf.save());
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex') };
}
const index = await drawing(true);
const target = await drawing(false);
const changed = await drawing(false, true);
const manifest = { version: 1, name: 'Index links', sheets: [
  { id: 'index', label: 'I-001', title: 'Index', filePath: 'Index.pdf', page: 1, sourceSha256: index.hash, history: [] },
  { id: 'arch', label: 'A-101', title: '', filePath: 'Index.pdf', page: 2, sourceSha256: index.hash, history: [] },
  { id: 'struct', label: 'S-201', title: '', filePath: 'S.pdf', page: 1, sourceSha256: target.hash, history: [] },
  { id: 'detail', label: 'D-301', title: '', filePath: 'S.pdf', page: 2, sourceSha256: target.hash, history: [] },
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
  await cache('Index.pdf', index.bytes);
  await cache('S.pdf', target.bytes);
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  await page.locator('#sheets-panel .sheets-row').filter({ hasText: 'I-001' }).click();
  await page.getByRole('button', { name: 'Review index navigation links' }).click();
  assert.equal(await page.locator('#set-link-registered-targets').count(), 0, 'index mode cannot switch to generic matching');
  assert.equal(await page.locator('#set-link-remove').count(), 0, 'index mode cannot remove unscoped set links');
  await page.locator('#set-link-find').click();
  const review = page.locator('#set-link-registered-review');
  await review.waitFor();
  const text = await review.innerText();
  assert.match(text, /A-101 FIRST FLOOR PLAN[\s\S]*Ready/u);
  assert.match(text, /S-201 STRUCTURAL PLAN[\s\S]*Ready/u);
  assert.match(text, /D-301 ROOF PLAN \/ D-301 PENTHOUSE PLAN[\s\S]*Ambiguous target/u);
  assert.match(text, /X-999 UNREGISTERED PLAN[\s\S]*Target page label is not registered/u);
  assert.equal(await review.locator('tbody input[type="checkbox"]').count(), 2);
  assert.deepEqual(downloads, [], 'Find is read-only');
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'))), manifest);

  await cache('S.pdf', changed.bytes);
  await page.locator('#set-link-create').click();
  await page.getByRole('status').filter({ hasText: 'changed since Find' }).waitFor();
  assert.deepEqual(downloads, [], 'changed target bytes abort output');
  await cache('S.pdf', target.bytes);
  await page.locator('#set-link-create').click();
  await page.locator('#set-link-result').waitFor();
  assert.match(await page.locator('#set-link-result').innerText(), /Links created: 2, in 2 files/u);
  assert.deepEqual(downloads.sort(), ['Index.pdf', 'S.pdf']);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'))), manifest);
  assert.deepEqual(errors, []);
  console.log('Index link acceptance passed: exact row review, blocked conflicts, changed-byte refusal, linked copies.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
