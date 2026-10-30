import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-sheet-compare-'));
async function pdf(texts) {
  const document = await PDFDocument.create();
  for (const text of texts) document.addPage([612, 792]).drawText(text);
  const bytes = new Uint8Array(await document.save());
  return { bytes, fingerprint: createHash('sha256').update(bytes).digest('hex') };
}
const old = await pdf(['Old cover', 'A-101 old page two']);
const current = await pdf(['New cover', 'Other page', 'A-101 new page three']);
const wrong = await pdf(['Unrelated drawing']);
const manifest = { version: 1, name: 'Reviewed comparison', sheets: [{
  id: 'sheet-a101', label: 'A-101', title: 'Lobby', revision: 'B',
  filePath: 'current.pdf', page: 3, sourceSha256: current.fingerprint,
  sourceAliases: [], history: [{ filePath: 'old.pdf', page: 2, revision: 'A',
    replacedAt: '2026-10-30T00:00:00Z', sourceSha256: old.fingerprint }],
}] };
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify(value)), manifest);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  await page.locator('#sheets-panel .sheets-row').click();

  const compare = page.getByRole('button', { name: 'Compare A-101 earlier revision A to current' });
  const preview = page.locator('[aria-label="Review sheet revision comparison"]');
  const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
  const register = () => page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  const active = () => page.evaluate(async () => (await import('/js/compare/compare-store.js')).compareActive());
  async function cache(name, bytes) {
    await page.evaluate(async ({ name, bytes }) => {
      (await import('/js/core/platform.js')).cacheWebFile(name, Uint8Array.from(bytes));
    }, { name, bytes: Array.from(bytes) });
  }

  await cache('current.pdf', current.bytes);
  await compare.click();
  await status('Earlier revision PDF is unavailable');
  assert.equal(await preview.count(), 0);
  assert.equal(await active(), false);
  assert.deepEqual(await register(), manifest);
  assert.equal(await page.locator('#sheets-panel .sheets-row').getAttribute('aria-pressed'), 'true');

  await cache('old.pdf', wrong.bytes);
  await compare.click();
  await status('Earlier revision PDF has changed');
  await cache('old.pdf', old.bytes);
  await cache('current.pdf', wrong.bytes);
  await compare.click();
  await status('Current revision PDF has changed');
  await cache('current.pdf', current.bytes);

  await compare.click();
  await preview.waitFor();
  assert.match(await preview.innerText(), /Earlier revision A · old\.pdf · Page 2/);
  assert.match(await preview.innerText(), /Current revision B · current\.pdf · Page 3/);
  assert.equal(await active(), false, 'review does not start a comparison');
  await cache('old.pdf', wrong.bytes);
  await page.getByRole('button', { name: 'Open comparison' }).click();
  await status('Earlier revision PDF has changed');
  assert.equal(await active(), false, 'changed bytes at confirmation refuse comparison');
  assert.deepEqual(await register(), manifest);

  await cache('old.pdf', old.bytes);
  await compare.click();
  await preview.waitFor();
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab('old.pdf', false);
    await loadPDFIfNeeded('old.pdf', index, Uint8Array.from(bytes));
    state.documents[index].modified = true;
  }, Array.from(old.bytes));
  await page.getByRole('button', { name: 'Open comparison' }).click();
  await status('has unsaved edits');
  assert.equal(await active(), false);
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    state.documents.find(doc => doc.filePath === 'old.pdf').modified = false;
  });

  await page.getByRole('button', { name: 'Open comparison' }).click();
  await page.locator('.document-tab.compare-tab').waitFor();
  const session = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return { oldPath: compare.compareOldPath(), newPath: compare.compareNewPath(),
      oldPage: compare.compareOldPage(), newPage: compare.compareNewPage(),
      mode: compare.compareMode(), focused: compare.compareFocused() };
  });
  assert.deepEqual(session, { oldPath: 'old.pdf', newPath: 'current.pdf', oldPage: 2,
    newPage: 3, mode: 'side', focused: true });
  assert.deepEqual(await register(), manifest, 'comparison never changes the drawing set');
  assert.equal(await page.locator('#sheets-panel .sheets-row').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('Sheet history compare passed: saved-byte checks, confirmation recheck, dirty-tab refusal, registered page pair, unchanged set');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
