import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PDFDocument, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer } from 'vite';

const old = await PDFDocument.create();
old.addPage([612, 792]);
const revised = await PDFDocument.create();
const revisedPage = revised.addPage([612, 792]);
revisedPage.drawRectangle({ x: 180, y: 280, width: 90, height: 65, color: rgb(0, 0, 0) });
// A saturated blue plan revision must count as ink, not paper-white.
revisedPage.drawRectangle({ x: 390, y: 570, width: 80, height: 60, color: rgb(36 / 255, 94 / 255, 158 / 255) });
const oldBytes = Array.from(await old.save());
const newBytes = Array.from(await revised.save());
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const downloadOrError = async button => {
    const result = Promise.race([
      page.waitForEvent('download', { timeout: 30000 }).then(file => ({ file })),
      page.getByRole('alert').waitFor({ timeout: 30000 }).then(async () => ({ error: await page.getByRole('alert').allTextContents() })),
    ]);
    await button.click();
    const outcome = await result;
    if (outcome.error) throw new Error(`Revision export failed: ${outcome.error.join(' | ')}`);
    return outcome.file;
  };
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async ({ oldBytes, newBytes }) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { cacheWebFile } = await import('/js/core/platform.js');
    for (const [name, bytes] of [['issued.pdf', oldBytes], ['revised.pdf', newBytes]]) {
      cacheWebFile(name, Uint8Array.from(bytes));
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(bytes));
    }
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const [oldDoc, newDoc] = state.documents.filter(doc => doc?.filePath && doc?.pdfDoc).slice(-2);
    compare.startCompare({ oldFilePath: oldDoc.filePath, newFilePath: newDoc.filePath, mode: 'side' });
    compare.confirmCurrentPagePair();
  }, { oldBytes, newBytes });
  await page.waitForFunction(async () => {
    const compare = await import('/js/compare/compare-store.js');
    if (compare.compareDetecting() || compare.compareChanges().length < 2) {
      window.__compareStableSince = 0;
      return false;
    }
    window.__compareStableSince ||= Date.now();
    return Date.now() - window.__compareStableSince > 500;
  });
  await page.locator('.compare-change-list div[style*="height: 50px"]').first().click();
  const button = page.getByRole('button', { name: 'Export selected region as marked-up PDF' });
  await button.waitFor();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('button'))
    .find(button => button.textContent?.trim() === 'Export selected region as marked-up PDF')?.disabled);
  const file = await downloadOrError(button);
  assert.match(file.suggestedFilename(), /revised-p1-change-1-review\.pdf$/u);
  const output = await readFile(await file.path());
  const task = getDocument({ data: new Uint8Array(output), useSystemFonts: false });
  try {
    const reopened = await task.promise;
    const annotations = await (await reopened.getPage(1)).getAnnotations();
    const square = annotations.find(item => item.subtype === 'Square' && item.contentsObj?.str?.includes('UNREVIEWED OcuDraw'));
    assert.ok(square, 'the exported copy must contain the selected region as an editable Square');
    assert.match(square.contentsObj.str, /Old source: issued\.pdf — page 1/u);
    assert.match(square.contentsObj.str, /New source: revised\.pdf — page 1/u);
    assert.equal(square.annotationFlags & (64 | 128), 0);
  } finally {
    await task.destroy();
  }

  const allButton = page.getByRole('button', { name: 'Export all detected regions on this pair' });
  await allButton.waitFor();
  assert.equal(await allButton.isDisabled(), false);
  const allFile = await downloadOrError(allButton);
  assert.match(allFile.suggestedFilename(), /revised-p1-changes-review\.pdf$/u);
  const allOutput = await readFile(await allFile.path());
  const allTask = getDocument({ data: new Uint8Array(allOutput), useSystemFonts: false });
  try {
    const reopened = await allTask.promise;
    const squares = (await (await reopened.getPage(1)).getAnnotations()).filter(item => item.subtype === 'Square');
    const expected = await page.evaluate(async () => (await import('/js/compare/compare-store.js')).compareChanges().length);
    assert.equal(squares.length, expected, 'each detected visual region gets its own editable Square');
    assert.equal(new Set(squares.map(item => item.contentsObj.str)).size, expected);
    for (const [index, square] of squares.entries()) {
      assert.match(square.contentsObj.str, new RegExp(`Change: ${index + 1} \\(`, 'u'));
      assert.match(square.contentsObj.str, /Old source: issued\.pdf — page 1/u);
      assert.match(square.contentsObj.str, /New source: revised\.pdf — page 1/u);
      assert.equal(square.annotationFlags & (64 | 128), 0);
    }
  } finally {
    await allTask.destroy();
  }

  await page.evaluate(bytes => import('/js/core/platform.js').then(module => module.cacheWebFile('revised.pdf', Uint8Array.from(bytes))), oldBytes);
  await button.click();
  await page.getByRole('alert').getByText(/source PDF changed since comparison/u).waitFor();
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { cacheWebFile } = await import('/js/core/platform.js');
    cacheWebFile('review-copy.pdf', Uint8Array.from(bytes));
    const { index } = createTab('review-copy.pdf');
    await loadPDF('review-copy.pdf', index, Uint8Array.from(bytes));
  }, Array.from(allOutput));
  await page.waitForFunction(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents.find(item => item?.filePath === 'review-copy.pdf');
    return doc?.annotations?.filter(item => item.type === 'box').length >= 2;
  });
  const listed = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { matchesMarkupSearch } = await import('/js/ui/panels/markup-search.js');
    const doc = state.documents.find(item => item?.filePath === 'review-copy.pdf');
    return doc.annotations.filter(item => item.type === 'box').map(item => ({
      page: item.page, subject: item.subject, editable: !item.locked && !item.readOnly,
      searchable: matchesMarkupSearch(item, 'issued.pdf revised.pdf unreviewed'),
    }));
  });
  assert.equal(listed.length, 2);
  assert.ok(listed.every(item => item.page === 1 && item.editable && item.searchable));
  assert.deepEqual(errors, []);
  console.log('Revision markup smoke passed: selected and all-region exports, Markups List fields, stale source rejected');
} finally {
  await browser?.close();
  await server?.close();
}
