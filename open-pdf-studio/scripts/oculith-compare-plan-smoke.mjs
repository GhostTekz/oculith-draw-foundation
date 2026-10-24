import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

async function pdfBytes() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  return Array.from(await pdf.save());
}

async function changedPdfBytes() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  pdf.setTitle('Different revision with the same page count');
  return Array.from(await pdf.save());
}

let server;
let browser;
try {
  const probe = createNetServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const bytes = await pdfBytes();
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    for (const name of ['issued.pdf', 'revised.pdf']) {
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(content));
    }
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const [oldDoc, newDoc] = state.documents.filter(doc => doc?.filePath && doc?.pdfDoc).slice(-2);
    compare.startCompare({ oldFilePath: oldDoc.filePath, newFilePath: newDoc.filePath, mode: 'side' });
    compare.setPagePair(1, 2);
    compare.confirmCurrentPagePair();
    compare.setPagePair(2, 1);
    compare.confirmCurrentPagePair();
    compare.setCompareOffset({ dx: 8, dy: -4, rotation: 2 });
  }, bytes);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.compare-plan button').filter({ hasText: 'Save plan JSON' }).click();
  const download = await downloadPromise;
  const saved = await readFile(await download.path());
  const plan = JSON.parse(saved.toString('utf8'));
  assert.equal(plan.format, 'ocudraw.compare-plan');
  assert.equal(plan.version, 2);
  const expectedHash = createHash('sha256').update(Uint8Array.from(bytes)).digest('hex');
  assert.deepEqual(plan.identity, { algorithm: 'SHA-256', old: expectedHash, new: expectedHash });
  assert.deepEqual(plan.pairs.map(pair => [pair.oldPage, pair.newPage]), [[1, 2], [2, 1]]);
  assert.deepEqual(plan.alignment, { dx: 8, dy: -4, rotation: 2 });

  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.startCompare({ oldFilePath: 'issued.pdf', newFilePath: 'revised.pdf', mode: 'side' });
    compare.confirmCurrentPagePair();
  });
  const badPlan = Buffer.from(JSON.stringify({
    ...plan, documents: { ...plan.documents, new: { ...plan.documents.new, pageCount: 3 } },
  }));
  const badChooser = page.waitForEvent('filechooser');
  await page.locator('.compare-plan button').filter({ hasText: 'Load plan JSON' }).click();
  await (await badChooser).setFiles({ name: 'wrong-count.json', mimeType: 'application/json', buffer: badPlan });
  await page.locator('.compare-plan [role="alert"]').getByText(/page counts do not match/).waitFor();
  assert.equal(await page.getByText('Review before replacing current matches').count(), 0);

  const changedIdentity = Buffer.from(JSON.stringify({
    ...plan, identity: { ...plan.identity, new: '0'.repeat(64) },
  }));
  const changedChooser = page.waitForEvent('filechooser');
  await page.locator('.compare-plan button').filter({ hasText: 'Load plan JSON' }).click();
  await (await changedChooser).setFiles({ name: 'changed-pdf.json', mimeType: 'application/json', buffer: changedIdentity });
  await page.locator('.compare-plan [role="alert"]').getByText(/PDF contents (differ|changed)/).waitFor();
  assert.equal(await page.getByText('Review before replacing current matches').count(), 0);

  const chooser = page.waitForEvent('filechooser');
  await page.locator('.compare-plan button').filter({ hasText: 'Load plan JSON' }).click();
  await (await chooser).setFiles({ name: 'review-plan.json', mimeType: 'application/json', buffer: saved });
  await page.getByText('Review before replacing current matches').waitFor();
  const before = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return { pairs: compare.compareConfirmedPairs().map(pair => [pair.oldPage, pair.newPage]), offset: compare.compareOffset() };
  });
  assert.deepEqual(before.pairs, [[1, 1]]);
  assert.deepEqual(before.offset, { dx: 0, dy: 0, rotation: 0 });
  await page.evaluate(async content => {
    const { setCachedPdfBytes } = await import('/js/pdf/loader.js');
    setCachedPdfBytes('revised.pdf', Uint8Array.from(content));
  }, await changedPdfBytes());
  await page.locator('.compare-plan button').filter({ hasText: 'Replace 1 current matches with plan' }).click();
  await page.locator('.compare-plan [role="alert"]').getByText(/PDF contents (differ|changed)/).waitFor();
  assert.equal(await page.getByText('Review before replacing current matches').count(), 1);
  assert.deepEqual(await page.evaluate(async () => (await import('/js/compare/compare-store.js'))
    .compareConfirmedPairs().map(pair => [pair.oldPage, pair.newPage])), [[1, 1]]);
  await page.evaluate(async content => {
    const { setCachedPdfBytes } = await import('/js/pdf/loader.js');
    setCachedPdfBytes('revised.pdf', Uint8Array.from(content));
  }, bytes);
  await page.locator('.compare-plan button').filter({ hasText: 'Replace 1 current matches with plan' }).click();
  const after = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return { pairs: compare.compareConfirmedPairs(), offset: compare.compareOffset() };
  });
  assert.deepEqual(after.pairs, plan.pairs);
  assert.deepEqual(after.offset, plan.alignment);
  assert.equal(await page.getByText('Review before replacing current matches').count(), 0);

  const legacy = { ...plan, version: 1 };
  delete legacy.identity;
  const legacyChooser = page.waitForEvent('filechooser');
  await page.locator('.compare-plan button').filter({ hasText: 'Load plan JSON' }).click();
  await (await legacyChooser).setFiles({ name: 'older-plan.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)) });
  await page.getByText('Older plan without fingerprints: verify the selected revisions before replacing matches.').waitFor();
  await page.locator('.compare-plan button').filter({ hasText: 'Discard plan' }).click();
  // A same-path Save can replace loader bytes while compare's rendered pdf.js
  // document still shows the old pages. A new plan must fail closed.
  const downloads = [];
  page.on('download', download => downloads.push(download));
  await page.evaluate(async content => {
    const { setCachedPdfBytes } = await import('/js/pdf/loader.js');
    setCachedPdfBytes('revised.pdf', Uint8Array.from(content));
  }, await changedPdfBytes());
  await page.locator('.compare-plan button').filter({ hasText: 'Save plan JSON' }).click();
  await page.locator('.compare-plan [role="alert"]').getByText(/changed since comparison began/).waitFor();
  assert.equal(downloads.length, 0);
  await page.evaluate(async content => {
    const { setCachedPdfBytes } = await import('/js/pdf/loader.js');
    setCachedPdfBytes('revised.pdf', Uint8Array.from(content));
  }, bytes);

  // Hold the second fingerprint pass, change the comparison, then release it.
  // The post-hash guard must prevent a stale JSON download.
  await page.evaluate(() => {
    const subtle = crypto.subtle;
    const original = subtle.digest.bind(subtle);
    const gate = { calls: 0, pending: false, release: null, restore: () => { delete subtle.digest; } };
    Object.defineProperty(subtle, 'digest', { configurable: true, value: (...args) => {
      gate.calls++;
      if (gate.calls === 3) return new Promise((resolve, reject) => {
        gate.pending = true;
        gate.release = () => original(...args).then(resolve, reject);
      });
      return original(...args);
    } });
    window.__compareDigestGate = gate;
  });
  await page.locator('.compare-plan button').filter({ hasText: 'Save plan JSON' }).click();
  await page.waitForFunction(() => window.__compareDigestGate?.pending);
  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.setCompareOffset({ dx: 11, dy: -4, rotation: 2 });
    window.__compareDigestGate.release();
  });
  await page.locator('.compare-plan [role="alert"]').getByText(/Comparison changed while saving/).waitFor();
  assert.equal(downloads.length, 0);
  await page.evaluate(() => { window.__compareDigestGate.restore(); delete window.__compareDigestGate; });
  const restartedBytes = await changedPdfBytes();
  await page.evaluate(async content => {
    const { setCachedPdfBytes } = await import('/js/pdf/loader.js');
    const compare = await import('/js/compare/compare-store.js');
    setCachedPdfBytes('revised.pdf', Uint8Array.from(content));
    compare.startCompare({ oldFilePath: 'issued.pdf', newFilePath: 'revised.pdf', mode: 'side' });
    compare.confirmCurrentPagePair();
  }, restartedBytes);
  const restartedDownload = page.waitForEvent('download');
  await page.locator('.compare-plan button').filter({ hasText: 'Save plan JSON' }).click();
  const restartedPlan = JSON.parse((await readFile(await (await restartedDownload).path())).toString('utf8'));
  assert.equal(restartedPlan.identity.new, createHash('sha256').update(Uint8Array.from(restartedBytes)).digest('hex'));
  assert.deepEqual(errors, []);
  console.log('Compare plan smoke passed: fingerprinted save/load/recheck, stale source and digest race rejected');
} finally {
  await browser?.close();
  await server?.close();
}
