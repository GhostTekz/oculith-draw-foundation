import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-index-titles-'));
const files = [];
for (const name of ['A-101', 'A-102', 'index']) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1000, 700]);
  if (name === 'index') {
    for (const [id, title, y] of [['A-101', 'FIRST FLOOR PLAN', 600],
      ['A-102', 'SECOND FLOOR PLAN', 570], ['A-103', 'UNREGISTERED PLAN', 540]]) {
      page.drawText(id, { x: 50, y, font, size: 12 });
      page.drawText(title, { x: 200, y, font, size: 12 });
    }
  } else page.drawText(`SHEET ${name}`, { x: 50, y: 600, font, size: 12 });
  const path = join(directory, `${name}.pdf`);
  await writeFile(path, await pdf.save());
  files.push(path);
}

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
  await (await chooser).setFiles(files);
  await page.getByRole('status').filter({ hasText: '3 sheets added' }).waitFor();
  const register = () => page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  const initial = await register();
  await page.locator('#sheets-panel .sheets-row').filter({ hasText: 'index' }).click();
  await page.getByRole('button', { name: 'Review titles from selected index sheet' }).click();
  const proposals = page.getByRole('group', { name: 'Sheet metadata proposals' });
  await proposals.waitFor();
  assert.equal(await page.getByLabel('Proposed title for A-101').inputValue(), 'FIRST FLOOR PLAN');
  assert.equal(await page.getByLabel('Proposed title for A-102').inputValue(), 'SECOND FLOOR PLAN');
  assert.equal(await page.getByLabel('Proposed sheet ID for A-101').isDisabled(), true);
  assert.match(await proposals.innerText(), /Index page 1, line at y=.*A-101 FIRST FLOOR PLAN/u);
  await page.locator('.sheets-metadata-review .sheets-suggestion-source summary').click();
  assert.match(await page.locator('.sheets-metadata-review .sheets-suggestion-source').innerText(), /A-103 UNREGISTERED PLAN/u);
  assert.deepEqual(await register(), initial, 'preview leaves the register unchanged');
  await page.getByRole('button', { name: 'Apply selected details' }).click();
  await page.getByRole('status').filter({ hasText: '2 sheets updated' }).waitFor();
  const applied = await register();
  assert.deepEqual(applied.sheets.map(sheet => sheet.label), initial.sheets.map(sheet => sheet.label));
  assert.deepEqual(applied.sheets.map(sheet => sheet.sourceSha256), initial.sheets.map(sheet => sheet.sourceSha256));
  assert.deepEqual(applied.sheets.map(sheet => sheet.title), ['FIRST FLOOR PLAN', 'SECOND FLOOR PLAN', '']);
  assert.deepEqual(errors, []);
  console.log('Index sheet title acceptance passed: real PDF geometry, unmatched row, preview, title-only Apply.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
