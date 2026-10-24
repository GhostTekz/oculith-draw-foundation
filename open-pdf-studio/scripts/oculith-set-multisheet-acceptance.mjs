import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-set-multisheet-'));
const sha256 = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

async function makePdf(name, pageTexts, numberedLabels = false) {
  const pdf = await PDFDocument.create();
  for (const text of pageTexts) pdf.addPage([612, 792]).drawText(text, { x: 48, y: 720, size: 16 });
  if (numberedLabels) pdf.catalog.set(PDFName.of('PageLabels'), pdf.context.obj({
    Nums: [0, { P: PDFHexString.fromText('A-'), S: PDFName.of('D'), St: 101 }],
  }));
  const bytes = new Uint8Array(await pdf.save());
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { path, name, bytes, fingerprint: sha256(bytes), pages: pageTexts };
}

const issued = await makePdf('issued.pdf', [
  'A-101 issued lobby', 'A-102 issued level two', 'A-103 issued roof',
], true);
const movedPath = join(directory, 'moved-issued.pdf');
const archivePath = join(directory, 'archive-issued.pdf');
await copyFile(issued.path, movedPath);
await copyFile(issued.path, archivePath);
const revised = await makePdf('revised.pdf', [
  'Revision B cover', 'Revision B unrelated plan', 'A-102 revision B relocated to page three',
]);
const wrong = await makePdf('wrong-history.pdf', [
  'Other PDF page one', 'Other PDF page two', 'Other PDF page three',
]);

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

  const register = () => page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  const row = label => page.locator('#sheets-panel .sheets-row').filter({ has: page.locator('strong', { hasText: label }) });
  async function choose(button, path) {
    const chooser = page.waitForEvent('filechooser');
    await button.click();
    await (await chooser).setFiles(path);
  }
  async function activeSource() {
    return page.evaluate(async () => {
      const { state } = await import('/js/core/state.ts');
      const doc = state.documents[state.activeDocumentIndex];
      const bytes = await doc.pdfDoc.getData();
      const pdfPage = await doc.pdfDoc.getPage(doc.currentPage);
      const content = await pdfPage.getTextContent();
      return { filePath: doc.filePath, page: doc.currentPage, pageCount: doc.pdfDoc.numPages,
        bytes: Array.from(bytes), text: content.items.map(item => item.str).join(' ') };
    });
  }
  async function expectSource(path, pageNumber, source, pageText) {
    await page.locator('#sheets-panel .sheets-navigation[aria-busy="false"]').waitFor();
    await page.waitForFunction(async ({ path, pageNumber }) => {
      const { state } = await import('/js/core/state.ts');
      const doc = state.documents[state.activeDocumentIndex];
      return doc?.filePath === path && doc.currentPage === pageNumber && !!doc.pdfDoc;
    }, { path, pageNumber });
    const opened = await activeSource();
    assert.equal(opened.page, pageNumber);
    assert.equal(opened.pageCount, source.pages.length);
    assert.deepEqual(Uint8Array.from(opened.bytes), source.bytes,
      `${path} must load the exact selected PDF bytes`);
    assert.equal(sha256(opened.bytes), source.fingerprint, `${path} must load the exact recorded PDF bytes`);
    assert.match(opened.text, new RegExp(pageText));
  }

  await choose(page.getByRole('button', { name: 'Add PDFs' }), issued.path);
  await page.getByRole('status').filter({ hasText: '3 sheets added' }).waitFor();
  const initial = await register();
  assert.deepEqual(initial.sheets.map(sheet => [sheet.label, sheet.page]),
    [['A-101', 1], ['A-102', 2], ['A-103', 3]], 'all labeled pages become separate sheets');
  assert.equal(new Set(initial.sheets.map(sheet => sheet.id)).size, 3);
  assert.ok(initial.sheets.every(sheet => sheet.filePath === issued.name &&
    sheet.sourceSha256 === issued.fingerprint && sheet.history.length === 0));
  const ids = Object.fromEntries(initial.sheets.map(sheet => [sheet.label, sheet.id]));

  for (const label of ['A-101', 'A-102', 'A-103']) {
    await row(label).click();
    await page.getByLabel('Revision', { exact: true }).fill('A');
    await page.getByLabel('Revision', { exact: true }).press('Tab');
  }
  await row('A-102').click();
  await choose(page.getByRole('button', { name: 'Relink', exact: true }), movedPath);
  assert.equal(await page.getByLabel('New source page').inputValue(), '2');
  await page.getByRole('button', { name: 'Confirm relink' }).click();
  const moved = await register();
  const movedSheet = moved.sheets.find(sheet => sheet.id === ids['A-102']);
  assert.equal(moved.sheets.length, 3);
  assert.equal(movedSheet.filePath, 'moved-issued.pdf');
  assert.equal(movedSheet.page, 2);
  assert.equal(movedSheet.sourceSha256, issued.fingerprint);
  assert.deepEqual(movedSheet.history, [], 'current relink must not invent a revision');
  assert.deepEqual(movedSheet.sourceAliases, [{ filePath: issued.name, page: 2,
    sourceSha256: issued.fingerprint }]);
  assert.deepEqual(moved.sheets.filter(sheet => sheet.id !== ids['A-102']),
    initial.sheets.filter(sheet => sheet.id !== ids['A-102']).map(sheet => ({ ...sheet, revision: 'A' })));
  await page.getByRole('button', { name: 'Open sheet', exact: true }).click();
  await expectSource('moved-issued.pdf', 2, issued, 'A-102 issued level two');

  await row('A-102').click();
  await page.getByLabel('Next revision').fill('B');
  await choose(page.getByRole('button', { name: 'Choose revised PDF' }), revised.path);
  await page.getByLabel('New source page').selectOption('3');
  await page.getByRole('button', { name: 'Record revision' }).click();
  const replacement = await register();
  const revisedSheet = replacement.sheets.find(sheet => sheet.id === ids['A-102']);
  assert.equal(replacement.sheets.length, 3, 'revision replacement does not register unrelated pages');
  assert.deepEqual(replacement.sheets.map(sheet => sheet.id), initial.sheets.map(sheet => sheet.id));
  assert.deepEqual([revisedSheet.filePath, revisedSheet.page, revisedSheet.revision, revisedSheet.sourceSha256],
    [revised.name, 3, 'B', revised.fingerprint]);
  assert.equal(revisedSheet.history.length, 1);
  assert.deepEqual({ ...revisedSheet.history[0], replacedAt: null }, {
    filePath: 'moved-issued.pdf', page: 2, revision: 'A', sourceSha256: issued.fingerprint,
    replacedAt: null,
  });
  assert.match(revisedSheet.history[0].replacedAt, /^\d{4}-\d\d-\d\dT/u);
  assert.deepEqual(replacement.sheets.filter(sheet => sheet.id !== ids['A-102']),
    moved.sheets.filter(sheet => sheet.id !== ids['A-102']), 'other sheets remain untouched');

  const relinkPrior = page.getByRole('button', { name: 'Relink A-102 earlier revision A' });
  await choose(relinkPrior, wrong.path);
  await page.getByRole('status').filter({ hasText: 'does not match the recorded earlier revision' }).waitFor();
  assert.deepEqual(await register(), replacement, 'wrong history bytes cannot change the drawing set');
  await choose(relinkPrior, archivePath);
  await page.getByText('Exact PDF match · Recorded page 2 of 3').waitFor();
  await page.getByRole('button', { name: 'Confirm earlier relink' }).click();
  await page.getByRole('status').filter({ hasText: 'Earlier revision relinked to the verified PDF' }).waitFor();
  const final = await register();
  const finalSheet = final.sheets.find(sheet => sheet.id === ids['A-102']);
  assert.deepEqual(final.sheets.map(sheet => sheet.id), initial.sheets.map(sheet => sheet.id));
  assert.deepEqual(final.sheets.filter(sheet => sheet.id !== ids['A-102']),
    replacement.sheets.filter(sheet => sheet.id !== ids['A-102']));
  assert.deepEqual({ ...finalSheet.history[0], filePath: 'moved-issued.pdf' }, revisedSheet.history[0],
    'historical relink changes only its path');
  assert.equal(finalSheet.history[0].filePath, 'archive-issued.pdf');
  assert.deepEqual({ ...finalSheet, history: revisedSheet.history }, revisedSheet,
    'current revision remains unchanged by historical relink');

  await page.getByRole('button', { name: 'Open A-102 earlier revision A' }).click();
  await expectSource('archive-issued.pdf', 2, issued, 'A-102 issued level two');
  await page.getByRole('button', { name: 'Open sheet', exact: true }).click();
  await expectSource(revised.name, 3, revised, 'A-102 revision B relocated to page three');
  for (const [label, sourcePage, text] of [
    ['A-101', 1, 'A-101 issued lobby'], ['A-103', 3, 'A-103 issued roof'],
  ]) {
    await row(label).click();
    await page.getByRole('button', { name: 'Open sheet', exact: true }).click();
    await expectSource(issued.name, sourcePage, issued, text);
  }
  assert.deepEqual(await register(), final, 'opening sources never mutates IDs or history');
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await register(), final, 'stable sheet IDs and lineage survive a new app session');
  assert.deepEqual(errors, []);
  console.log('Multi-sheet acceptance passed: stable IDs, exact current/history bytes, page-3 revision replacement');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
