import assert from 'node:assert/strict';
import { copyFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-sheet-revisions-'));

async function makePdf(name, pageCount) {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < pageCount; page++) pdf.addPage([612, 792]);
  const path = join(directory, name);
  await writeFile(path, await pdf.save());
  return path;
}

const oldPath = await makePdf('old.pdf', 1);
const revisedPath = await makePdf('revised.pdf', 3);
const movedPath = await makePdf('moved.pdf', 2);
const renamedPath = join(directory, 'moved-renamed.pdf');
await copyFile(movedPath, renamedPath);
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
    version: 1, name: 'Test drawings', sheets: [{ id: 'sheet-a101', label: 'A-101', title: 'Level 1',
      revision: 'A', filePath: 'old.pdf', page: 1, history: [], sourceAliases: [] }],
  })));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('#left-panel .left-panel-tab[data-panel="sheets"]').click();
  await page.locator('#sheets-panel .sheets-row').click();
  assert.match(await page.locator('#sheets-panel .sheets-source').innerText(), /old\.pdf · Page 1 · Revision A/);

  await page.getByLabel('Next revision').fill('B');
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose revised PDF' }).click();
  await (await chooser).setFiles(revisedPath);
  await page.getByLabel('New source page').selectOption('3');
  await page.getByRole('button', { name: 'Record revision' }).click();
  assert.match(await page.locator('#sheets-panel .sheets-source').innerText(), /revised\.pdf · Page 3 · Revision B/);
  assert.match(await page.locator('#sheets-panel .sheets-history-item').innerText(), /old\.pdf · Page 1/);

  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Relink', exact: true }).click();
  await (await chooser).setFiles(movedPath);
  await page.getByLabel('New source page').selectOption('2');
  await page.getByRole('button', { name: 'Confirm relink' }).click();
  const register = await page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  assert.equal(register.sheets.length, 1);
  assert.equal(register.sheets[0].id, 'sheet-a101');
  assert.equal(register.sheets[0].page, 2);
  assert.equal(register.sheets[0].history.length, 1);
  assert.equal(register.sheets[0].sourceAliases[0].filePath, 'revised.pdf');
  assert.equal(register.sheets[0].sourceAliases[0].page, 3);
  assert.match(register.sheets[0].sourceAliases[0].sourceSha256, /^[a-f0-9]{64}$/);

  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add PDFs' }).click();
  await (await chooser).setFiles(oldPath);
  await page.getByRole('status').waitFor();
  assert.equal(await page.locator('#sheets-panel .sheets-row').count(), 1);

  const dialogs = [];
  page.once('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add PDFs' }).click();
  await (await chooser).setFiles(renamedPath);
  await page.getByRole('status').filter({ hasText: 'relinked to the selected PDF' }).waitFor();
  const renamed = await page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /same contents/);
  const retained = renamed.sheets.find(sheet => sheet.id === 'sheet-a101');
  assert.equal(renamed.sheets.length, 2); // The other page of the two-page PDF is newly registered.
  assert.equal(retained.filePath, 'moved-renamed.pdf');
  assert.equal(retained.history.length, 1);
  assert.ok(retained.sourceAliases.some(item => item.filePath === 'moved.pdf'));

  const changedPdf = await PDFDocument.create();
  changedPdf.addPage([612, 792]).drawText('Changed drawing page one');
  changedPdf.addPage([612, 792]).drawText('Changed drawing page two');
  await writeFile(renamedPath, await changedPdf.save());
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add PDFs' }).click();
  await (await chooser).setFiles(renamedPath);
  await page.getByRole('status').filter({ hasText: 'changed at a registered path' }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1'))), renamed);
  assert.deepEqual(errors, []);
  console.log('Sheet revision smoke passed: page choice, history, relink, renamed copy, changed-path refusal');
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
