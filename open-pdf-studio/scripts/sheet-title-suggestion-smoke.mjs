import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-sheet-suggest-'));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const vector = pdf.addPage([1000, 700]);
for (const [text, y] of [['SHEET NO.', 140], ['A-101', 110], ['SHEET TITLE', 80], ['FIRST FLOOR PLAN', 50]]) {
  vector.drawText(text, { x: 720, y, font, size: 12 });
}
pdf.addPage([1000, 700]); // An image-only page exposes no selectable text.
const source = join(directory, 'title-block.pdf');
await writeFile(source, await pdf.save());

const server = await createServer({
  cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add PDFs' }).click();
  await (await chooser).setFiles(source);
  await page.getByRole('status').filter({ hasText: '2 sheets added' }).waitFor();
  const register = () => page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  const initial = await register();
  const rows = page.locator('#sheets-panel .sheets-row');
  await rows.first().click();
  await page.getByRole('button', { name: 'Suggest from selectable PDF text' }).click();
  await page.getByLabel('Review title-block suggestions').waitFor();
  assert.equal(await page.getByLabel('Suggested sheet ID').inputValue(), 'A-101');
  assert.equal(await page.getByLabel('Suggested sheet title').inputValue(), 'FIRST FLOOR PLAN');
  assert.match(await page.getByText('SHEET NO. / A-101').textContent(), /A-101/u);
  assert.deepEqual(await register(), initial, 'reading a suggestion leaves the drawing set unchanged');
  assert.equal(await page.getByLabel('Sheet ID', { exact: true }).inputValue(), initial.sheets[0].label);
  assert.equal(await page.getByLabel('Sheet title', { exact: true }).inputValue(), '');

  await page.getByLabel('Suggested sheet title').fill('GROUND FLOOR PLAN');
  assert.deepEqual(await register(), initial, 'editing the preview does not write the drawing set');
  await page.getByRole('button', { name: 'Apply suggestions' }).click();
  const applied = await register();
  assert.equal(applied.sheets[0].label, 'A-101');
  assert.equal(applied.sheets[0].title, 'GROUND FLOOR PLAN');
  assert.deepEqual(applied.sheets[1], initial.sheets[1], 'other source pages stay unchanged');

  await rows.last().click();
  await page.getByRole('button', { name: 'Suggest from selectable PDF text' }).click();
  await page.getByRole('status').filter({ hasText: 'No selectable PDF text was found' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Apply suggestions' }).isDisabled(), true);
  assert.deepEqual(await register(), applied, 'blank page cannot change the drawing set automatically');
  assert.deepEqual(errors, []);
  console.log('Sheet suggestion acceptance passed: preview, explicit Apply, and blank-page restraint.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
