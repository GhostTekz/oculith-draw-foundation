import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { unzip } from '../js/bcf/bcf-zip.js';

const directory = await mkdtemp(join(tmpdir(), 'oculith-issue-package-'));
async function pdf(label) {
  const document = await PDFDocument.create();
  document.addPage([612, 792]).drawText(`${label} first`);
  document.addPage([612, 792]).drawText(`${label} second`);
  return new Uint8Array(await document.save());
}
const bytes = await pdf('Original');
const changed = await pdf('Changed');
const hash = createHash('sha256').update(bytes).digest('hex');
const register = { version: 1, name: 'Issue set', sheets: [
  { id: 'one', label: 'A-101', title: 'First', revision: 'B',
    filePath: 'Set.pdf', page: 1, sourceSha256: hash, history: [] },
  { id: 'two', label: 'A-102', title: 'Second', revision: 'B',
    filePath: 'Set.pdf', page: 2, sourceSha256: hash, history: [] },
] };
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const errors = [];
  const downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.addInitScript(value => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify(value)), register);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async data => {
    (await import('/js/core/platform.js')).cacheWebFile('Set.pdf', Uint8Array.from(data));
  }, Array.from(bytes));
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  await page.getByRole('button', { name: 'Check transmittal readiness' }).click();
  await page.getByText('Current sheet source readiness · 2 of 2 ready').waitFor();
  await page.getByLabel('Include A-101 in issue package').check();
  assert.equal(await page.getByLabel('Include A-102 in issue package').isChecked(), false);
  assert.deepEqual(downloads, [], 'selection does not write a package');
  await page.getByRole('button', { name: 'Preview issue package' }).click();
  const preview = page.locator('[data-set-package-preview]');
  await Promise.race([
    preview.waitFor({ timeout: 10000 }),
    page.getByText(/Could not preview issue package/u).waitFor({ timeout: 10000 })
      .then(async () => { throw new Error(await page.locator('.sheets-message').innerText()); }),
  ]);
  assert.match(await preview.innerText(), /1 selected pages · 1 verified source PDFs/u);
  await preview.getByText('Review package manifest').click();
  const visibleManifest = JSON.parse(await preview.locator('pre').innerText());
  assert.deepEqual(visibleManifest.sheets.map(sheet => sheet.label), ['A-101']);
  assert.deepEqual(downloads, [], 'preview does not write a package');
  await page.evaluate(async data => {
    (await import('/js/core/platform.js')).cacheWebFile('Set.pdf', Uint8Array.from(data));
  }, Array.from(changed));
  await preview.getByRole('button', { name: 'Export issue package ZIP' }).click();
  await page.locator('.sheets-message').getByText(/changed or became unavailable since package preview/u).waitFor();
  assert.deepEqual(downloads, [], 'stale source is rejected before download');
  await page.evaluate(async data => {
    (await import('/js/core/platform.js')).cacheWebFile('Set.pdf', Uint8Array.from(data));
  }, Array.from(bytes));
  const downloadPromise = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'Export issue package ZIP' }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'Issue set-issue.zip');
  const archive = await unzip(new Uint8Array(await readFile(await download.path())));
  assert.deepEqual([...archive.keys()], ['manifest.json', 'current-sheets.pdf']);
  const manifest = JSON.parse(new TextDecoder().decode(archive.get('manifest.json')));
  assert.deepEqual(manifest.sheets.map(sheet => [sheet.label, sheet.sourcePage, sheet.packagePage]),
    [['A-101', 1, 1]]);
  assert.equal(manifest.sources.length, 1);
  assert.equal(manifest.sources[0].sha256, hash);
  const selected = await PDFDocument.load(archive.get('current-sheets.pdf').slice());
  assert.equal(selected.getPageCount(), 1, 'the unselected source page is not packaged');
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'))), register);
  assert.deepEqual(errors, []);
  console.log('Issue package acceptance passed: explicit selected-page preview, stale-source refusal, ZIP export, unchanged register.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
