import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer } from 'vite';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function sourcePdf(labels, markedPage) {
  const pdf = await PDFDocument.create();
  for (const [index, label] of labels.entries()) {
    const page = pdf.addPage([612, 792]);
    page.drawText(label, { x: 48, y: 720, size: 18 });
    if (index === 2 && labels.length === 3) {
      page.setCropBox(36, 40, 504, 680);
      page.setRotation(degrees(90));
    }
    if (index === markedPage) {
      const note = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [60, 600, 90, 630],
        Contents: PDFString.of(`Review note on ${label}`) });
      page.node.set(PDFName.of('Annots'), pdf.context.obj([note]));
    }
  }
  return new Uint8Array(await pdf.save());
}

const issued = await sourcePdf(['A-101 revision A', 'A-102 revision A', 'A-103 revision A'], 0);
const revised = await sourcePdf(['B cover, not a registered sheet', 'A-102 revision B'], 1);
const register = { version: 1, name: 'Review set', sheets: [
  { id: 'sheet-103', label: 'A-103', title: 'Roof', revision: 'A',
    filePath: 'issued.pdf', page: 3, sourceSha256: digest(issued), history: [], sourceAliases: [] },
  { id: 'sheet-101', label: 'A-101', title: 'Lobby', revision: 'A',
    filePath: 'issued.pdf', page: 1, sourceSha256: digest(issued), history: [], sourceAliases: [] },
  { id: 'sheet-102', label: 'A-102', title: 'Level two', revision: 'B',
    filePath: 'revised.pdf', page: 2, sourceSha256: digest(revised),
    history: [{ filePath: 'issued.pdf', page: 2, revision: 'A',
      replacedAt: '2026-10-13T00:00:00Z', sourceSha256: digest(issued) }], sourceAliases: [] },
] };

const probe = createNetServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: { port } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const errors = [];
  const downloads = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('download', item => downloads.push(item));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async ({ issuedBytes, revisedBytes, set }) => {
    const { cacheWebFile } = await import('/js/core/platform.js');
    const { saveSheetRegister } = await import('/js/solid/stores/sheetRegisterStore.js');
    cacheWebFile('issued.pdf', Uint8Array.from(issuedBytes));
    cacheWebFile('revised.pdf', Uint8Array.from(revisedBytes));
    saveSheetRegister(set);
  }, { issuedBytes: Array.from(issued), revisedBytes: Array.from(revised), set: register });
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  const publish = page.getByRole('button', { name: 'Publish current sheets PDF' });
  const download = page.waitForEvent('download');
  await publish.click();
  const output = new Uint8Array(await readFile(await (await download).path()));
  await page.getByRole('status').filter({ hasText: '3 current sheets published' }).waitFor();
  assert.equal(downloads.length, 1);

  const parsed = await PDFDocument.load(output);
  assert.equal(parsed.getPageCount(), 3);
  assert.deepEqual(parsed.getPage(2).getRotation().angle, 90);
  assert.deepEqual(parsed.getPage(2).getCropBox(), { x: 36, y: 40, width: 504, height: 680 });
  const task = getDocument({ data: output.slice(), useSystemFonts: false,
    standardFontDataUrl: fileURLToPath(new URL('../public/pdfjs/web/standard_fonts/', import.meta.url)) });
  const reader = await task.promise;
  const pageTexts = [];
  const notes = [];
  for (let number = 1; number <= reader.numPages; number++) {
    const sheet = await reader.getPage(number);
    pageTexts.push((await sheet.getTextContent()).items.map(item => item.str).join(' '));
    notes.push((await sheet.getAnnotations()).map(item => item.contentsObj?.str || item.contents || ''));
  }
  await task.destroy();
  assert.match(pageTexts[0], /A-101 revision A/u);
  assert.match(pageTexts[1], /A-102 revision B/u);
  assert.match(pageTexts[2], /A-103 revision A/u);
  assert.ok(pageTexts.every(text => !text.includes('B cover') && !text.includes('A-102 revision A')),
    'unregistered and historical pages stay out of the published PDF');
  assert.deepEqual(notes.map(items => items.length), [1, 1, 0], 'source markups survive page copying');
  assert.match(notes[1][0], /revision B/u);

  // Replacing the current source cache with the old revision must fail before
  // another download starts, even though that old PDF is listed in history.
  await page.evaluate(async bytes => {
    (await import('/js/core/platform.js')).cacheWebFile('revised.pdf', Uint8Array.from(bytes));
  }, Array.from(issued));
  await publish.click();
  await page.getByRole('status').filter({ hasText: 'A-102: current PDF changed' }).waitFor();
  assert.equal(downloads.length, 1);

  await page.evaluate(async ({ set, revisedBytes }) => {
    (await import('/js/core/platform.js')).cacheWebFile('revised.pdf', Uint8Array.from(revisedBytes));
    const { saveSheetRegister } = await import('/js/solid/stores/sheetRegisterStore.js');
    const missing = structuredClone(set);
    missing.sheets[0].filePath = 'missing.pdf';
    saveSheetRegister(missing);
  }, { set: register, revisedBytes: Array.from(revised) });
  await publish.click();
  await page.getByRole('status').filter({ hasText: 'A-103: current PDF is unavailable' }).waitFor();
  assert.equal(downloads.length, 1);
  assert.deepEqual(errors, []);
  console.log('Set publish passed: 3 current sheets, 2 revisions, markups, geometry, mismatch and missing source');
} finally {
  await browser?.close();
  await server?.close();
}
