import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-current-relink-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function pdf(name, text) {
  const document = await PDFDocument.create();
  document.addPage([612, 792]).drawText(text);
  const bytes = new Uint8Array(await document.save());
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { path, bytes, hash: hash(bytes) };
}

const issued = await pdf('issued.pdf', 'A-101 issued drawing');
const moved = { path: join(directory, 'moved.pdf') };
await copyFile(issued.path, moved.path);
const changed = await pdf('changed.pdf', 'A-101 revision B drawing');
const unrelated = await pdf('unrelated.pdf', 'Unrelated drawing');
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();

  const register = () => page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  const relink = () => page.getByRole('button', { name: 'Relink', exact: true });
  const revised = () => page.getByRole('button', { name: 'Choose revised PDF' });
  const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
  async function choose(button, path) {
    const chooser = page.waitForEvent('filechooser');
    await button.click();
    await (await chooser).setFiles(path);
  }
  async function replaceCached(name, bytes) {
    await page.evaluate(async ({ name, bytes }) => {
      const { cacheWebFile } = await import('/js/core/platform.js');
      cacheWebFile(name, Uint8Array.from(bytes));
    }, { name, bytes: Array.from(bytes) });
  }

  await choose(page.getByRole('button', { name: 'Add PDFs' }), issued.path);
  await status('1 sheet added');
  await page.locator('#sheets-panel .sheets-row').click();
  await page.getByLabel('Revision', { exact: true }).fill('A');
  await page.getByLabel('Revision', { exact: true }).press('Tab');
  const original = await register();
  assert.equal(original.sheets[0].sourceSha256, issued.hash);

  await choose(relink(), unrelated.path);
  await status('does not match the recorded sheet');
  assert.deepEqual(await register(), original, 'wrong PDF cannot mutate current source');
  assert.equal(await page.getByRole('button', { name: 'Confirm relink' }).count(), 0);

  await choose(relink(), moved.path);
  await page.getByText('Exact PDF fingerprint match').waitFor();
  await replaceCached('moved.pdf', unrelated.bytes);
  await page.getByRole('button', { name: 'Confirm relink' }).click();
  await status('Selected PDF changed since it was chosen');
  assert.deepEqual(await register(), original, 'changed bytes at confirmation cannot relink');
  assert.equal((await register()).sheets[0].filePath, 'issued.pdf');

  await choose(relink(), moved.path);
  await page.getByRole('button', { name: 'Confirm relink' }).click();
  await status('Sheet source relinked');
  const exact = await register();
  assert.equal(exact.sheets[0].id, original.sheets[0].id);
  assert.equal(exact.sheets[0].filePath, 'moved.pdf');
  assert.equal(exact.sheets[0].sourceSha256, issued.hash);
  assert.deepEqual(exact.sheets[0].history, []);

  await page.getByLabel('Next revision').fill('B');
  await choose(revised(), changed.path);
  await page.getByText('New revision source').waitFor();
  await replaceCached('changed.pdf', unrelated.bytes);
  await page.getByRole('button', { name: 'Record revision' }).click();
  await status('Selected PDF changed since it was chosen');
  assert.deepEqual(await register(), exact, 'changed bytes at confirmation cannot record a revision');

  await choose(revised(), changed.path);
  await page.getByRole('button', { name: 'Record revision' }).click();
  await status('Revision recorded');
  const recorded = await register();
  assert.equal(recorded.sheets[0].id, original.sheets[0].id);
  assert.equal(recorded.sheets[0].sourceSha256, changed.hash);
  assert.equal(recorded.sheets[0].revision, 'B');
  assert.equal(recorded.sheets[0].history[0].sourceSha256, issued.hash);

  const changedSamePath = await pdf('changed.pdf', 'A-101 revision C at same path');
  await page.getByLabel('Next revision').fill('B');
  await choose(revised(), changedSamePath.path);
  await page.getByText('New revision source').waitFor();
  await page.getByRole('button', { name: 'Record revision' }).click();
  await status('Enter a new revision before recording it');
  assert.deepEqual(await register(), recorded, 'new bytes at the same path cannot be recorded under the old revision');

  await page.getByLabel('Next revision').fill('C');
  await choose(revised(), changedSamePath.path);
  await page.getByText('New revision source').waitFor();
  await page.getByRole('button', { name: 'Record revision' }).click();
  await status('Revision recorded');
  const recordedAtSamePath = await register();
  assert.equal(recordedAtSamePath.sheets[0].id, original.sheets[0].id);
  assert.equal(recordedAtSamePath.sheets[0].filePath, 'changed.pdf');
  assert.equal(recordedAtSamePath.sheets[0].revision, 'C');
  assert.equal(recordedAtSamePath.sheets[0].sourceSha256, changedSamePath.hash);
  assert.equal(recordedAtSamePath.sheets[0].history[1].filePath, 'changed.pdf');
  assert.equal(recordedAtSamePath.sheets[0].history[1].sourceSha256, changed.hash);

  const legacy = { version: 1, name: 'Legacy set', sheets: [{
    id: 'legacy-a101', label: 'A-101', title: '', revision: 'A',
    filePath: 'old-location.pdf', page: 1, history: [], sourceAliases: [],
  }] };
  await page.evaluate(value => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify(value)), legacy);
  await page.reload({ waitUntil: 'networkidle' });
  if (!(await page.locator('#sheets-panel').isVisible())) {
    await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  }
  await page.locator('#sheets-panel .sheets-row').click();
  await choose(relink(), unrelated.path);
  await page.getByText('No fingerprint was recorded for this sheet').waitFor();
  assert.deepEqual(await register(), legacy, 'legacy warning appears before any register mutation');
  await page.getByRole('button', { name: 'Confirm relink' }).click();
  await status('Sheet source relinked');
  const legacyRelinked = await register();
  assert.equal(legacyRelinked.sheets[0].id, legacy.sheets[0].id);
  assert.equal(legacyRelinked.sheets[0].filePath, 'unrelated.pdf');
  assert.equal(legacyRelinked.sheets[0].sourceSha256, unrelated.hash);
  assert.deepEqual(errors, []);
  console.log('Current relink integrity passed: mismatch refusal, confirmation re-read, exact-copy relink, same-path revision, legacy warning');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
