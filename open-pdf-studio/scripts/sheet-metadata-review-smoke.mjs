import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-metadata-review-'));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const [number, title] of [['A-101', 'FIRST FLOOR PLAN'], ['A-102', 'SECOND FLOOR PLAN']]) {
  const page = pdf.addPage([1000, 700]);
  for (const [value, y] of [['SHEET NO.', 140], [number, 110], ['SHEET TITLE', 80], [title, 50]]) {
    page.drawText(value, { x: 720, y, font, size: 12 });
  }
}
pdf.addPage([1000, 700]);
const source = join(directory, 'drawings.pdf');
await writeFile(source, await pdf.save());

const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 5188, strictPort: false, hmr: false }, logLevel: 'error' });
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
  await page.getByRole('status').filter({ hasText: '3 sheets added' }).waitFor();
  const register = () => page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  const initial = await register();
  await page.getByRole('button', { name: 'Review sheet numbers and titles' }).click();
  await page.getByRole('group', { name: 'Sheet metadata proposals' }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: `Apply metadata for ${initial.sheets[0].label}` }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: `Apply metadata for ${initial.sheets[1].label}` }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: `Apply metadata for ${initial.sheets[2].label}` }).isChecked(), false);
  assert.equal(await page.getByLabel(`Proposed sheet ID for ${initial.sheets[0].label}`).inputValue(), 'A-101');
  assert.equal(await page.getByLabel(`Proposed title for ${initial.sheets[1].label}`).inputValue(), 'SECOND FLOOR PLAN');
  assert.match(await page.getByRole('group', { name: 'Sheet metadata proposals' }).innerText(), /SHEET NO\. \/ A-101/u);
  assert.deepEqual(await register(), initial, 'reviewing source text leaves the register unchanged');

  await page.getByLabel(`Proposed sheet ID for ${initial.sheets[1].label}`).fill('A-101');
  await page.getByRole('button', { name: 'Apply selected details' }).click();
  await page.getByRole('status').filter({ hasText: 'already in this set' }).waitFor();
  assert.deepEqual(await register(), initial, 'duplicate final IDs reject the whole batch');

  await page.getByLabel(`Proposed sheet ID for ${initial.sheets[1].label}`).fill('A-102');
  await page.getByRole('button', { name: 'Apply selected details' }).click();
  await page.getByRole('status').filter({ hasText: '2 sheets updated' }).waitFor();
  const applied = await register();
  assert.deepEqual(applied.sheets.map(sheet => sheet.label), ['A-101', 'A-102', initial.sheets[2].label]);
  assert.deepEqual(applied.sheets.map(sheet => sheet.title), ['FIRST FLOOR PLAN', 'SECOND FLOOR PLAN', '']);
  assert.equal(applied.sheets[0].sourceSha256, initial.sheets[0].sourceSha256);
  assert.deepEqual(applied.sheets[2], initial.sheets[2], 'image-only page remains unchanged');
  assert.deepEqual(errors, []);
  console.log('Batch sheet metadata acceptance passed: source evidence, duplicate rejection, atomic Apply, and image-only restraint.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
