import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
fixture.addPage([612, 792]);
const bytes = Array.from(await fixture.save());
const replacedFixture = await PDFDocument.create();
replacedFixture.setTitle('Same-page-count replacement');
replacedFixture.addPage([612, 792]);
replacedFixture.addPage([612, 792]);
const replacedBytes = Array.from(await replacedFixture.save());
const probe = createNetServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: { port } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const openComparison = async content => page.evaluate(async content => {
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
  }, content);

  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await openComparison(bytes);
  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.setPagePair(1, 2);
    compare.confirmCurrentPagePair();
    compare.setPagePair(2, 1);
    compare.confirmCurrentPagePair();
    compare.setCompareOffset({ dx: 8, dy: -4, rotation: 2 });
  });
  await page.getByRole('button', { name: 'Save session locally' }).click();
  await page.getByText('Comparison saved on this device.').waitFor();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ocudraw.compare-snapshots.v1')));
  assert.equal(stored.version, 2);
  assert.equal(stored.entries.length, 1);
  assert.deepEqual(stored.entries[0].plan.pairs.map(pair => [pair.oldPage, pair.newPage]), [[1, 2], [2, 1]]);
  assert.match(stored.entries[0].identity.old, /^[0-9a-f]{64}$/u);
  assert.match(stored.entries[0].identity.new, /^[0-9a-f]{64}$/u);

  await page.reload({ waitUntil: 'networkidle' });
  await openComparison(replacedBytes);
  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.confirmCurrentPagePair();
  });
  await page.locator('.compare-snapshots summary').click();
  await page.getByRole('button', { name: 'Review saved session' }).click();
  await page.locator('.compare-plan [role="alert"]').getByText(/PDF contents differ from this saved session/u).waitFor();
  assert.equal(await page.getByText('Review before replacing current matches').count(), 0);
  assert.deepEqual(await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return compare.compareConfirmedPairs().map(pair => [pair.oldPage, pair.newPage]);
  }), [[1, 1]]);

  await page.reload({ waitUntil: 'networkidle' });
  await openComparison(bytes);
  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.confirmCurrentPagePair();
  });
  await page.locator('.compare-snapshots summary').click();
  await page.getByRole('button', { name: 'Review saved session' }).click();
  await page.getByText('Review before replacing current matches').waitFor();
  const before = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return { pairs: compare.compareConfirmedPairs().map(pair => [pair.oldPage, pair.newPage]), offset: compare.compareOffset() };
  });
  assert.deepEqual(before, { pairs: [[1, 1]], offset: { dx: 0, dy: 0, rotation: 0 } });

  await page.evaluate(async content => {
    const { setCachedPdfBytes } = await import('/js/pdf/loader.js');
    setCachedPdfBytes('revised.pdf', Uint8Array.from(content));
  }, replacedBytes);
  await page.getByRole('button', { name: 'Replace 1 current matches with plan' }).click();
  await page.locator('.compare-plan [role="alert"]').getByText(/PDF contents differ from this saved session/u).waitFor();
  assert.deepEqual(await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return compare.compareConfirmedPairs().map(pair => [pair.oldPage, pair.newPage]);
  }), [[1, 1]]);
  await page.evaluate(async content => {
    const { setCachedPdfBytes } = await import('/js/pdf/loader.js');
    setCachedPdfBytes('revised.pdf', Uint8Array.from(content));
  }, bytes);
  await page.getByRole('button', { name: 'Replace 1 current matches with plan' }).click();
  const after = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return { pairs: compare.compareConfirmedPairs().map(pair => [pair.oldPage, pair.newPage]), offset: compare.compareOffset() };
  });
  assert.deepEqual(after, { pairs: [[1, 2], [2, 1]], offset: { dx: 8, dy: -4, rotation: 2 } });

  await page.getByRole('button', { name: 'Remove saved session' }).click();
  assert.equal(await page.getByText('No saved comparison sessions yet.').count(), 1);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('ocudraw.compare-snapshots.v1')))).entries.length, 0);
  await page.evaluate(entry => {
    const { identity, ...legacy } = entry;
    localStorage.setItem('ocudraw.compare-snapshots.v1', JSON.stringify({
      format: 'ocudraw.compare-snapshots', version: 1, entries: [legacy],
    }));
  }, stored.entries[0]);
  await page.reload({ waitUntil: 'networkidle' });
  await openComparison(bytes);
  await page.locator('.compare-snapshots summary').click();
  assert.equal(await page.getByRole('button', { name: 'Review saved session' }).isDisabled(), true);
  assert.match(await page.locator('.compare-snapshot').innerText(), /Older session without PDF fingerprints/u);
  assert.deepEqual(errors, []);
  console.log('Compare history smoke passed: same-path replacement blocked, valid restore, legacy entry disabled');
} finally {
  await browser?.close();
  await server?.close();
}
