import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-history-relink-'));

async function makePdf(name, texts) {
  const pdf = await PDFDocument.create();
  for (const text of texts) pdf.addPage([612, 792]).drawText(text);
  const bytes = await pdf.save();
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { path, fingerprint: createHash('sha256').update(bytes).digest('hex') };
}

const old = await makePdf('renamed-old.pdf', ['Revision A cover', 'Revision A sheet A-101']);
const middle = await makePdf('middle.pdf', ['Revision B sheet A-101']);
const revised = await makePdf('current.pdf', ['Revision C sheet A-101']);
const wrong = await makePdf('different-old.pdf', ['Another drawing', 'Wrong page']);
const manifest = { version: 1, name: 'History relink fixture', sheets: [{
  id: 'sheet-a101', label: 'A-101', title: 'Level 1', revision: 'C',
  filePath: 'missing-current.pdf', page: 1, sourceSha256: revised.fingerprint,
  sourceAliases: [], history: [{ filePath: 'missing-earlier.pdf', page: 2,
    revision: 'A', replacedAt: '2026-10-13T00:00:00Z', sourceSha256: old.fingerprint },
  { filePath: 'missing-middle.pdf', page: 1, revision: 'B',
    replacedAt: '2026-10-14T00:00:00Z', sourceSha256: middle.fingerprint }],
}] };

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify(value)), manifest);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('#left-panel .left-panel-tab[data-panel="sheets"]').click();
  await page.locator('#sheets-panel .sheets-row').click();

  const openPrior = page.getByRole('button', { name: 'Open A-101 earlier revision A' });
  await openPrior.click();
  await page.getByRole('status').filter({ hasText: 'Use Relink on this earlier revision' }).waitFor();

  const relinkPrior = page.getByRole('button', { name: 'Relink A-101 earlier revision A' });
  let chooser = page.waitForEvent('filechooser');
  await relinkPrior.click();
  await (await chooser).setFiles(wrong.path);
  await page.getByRole('status').filter({ hasText: 'does not match the recorded earlier revision' }).waitFor();
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1'))), manifest,
    'wrong PDF leaves the complete drawing set unchanged');
  assert.equal(await page.getByRole('button', { name: 'Confirm earlier relink' }).count(), 0);

  chooser = page.waitForEvent('filechooser');
  await relinkPrior.click();
  await (await chooser).setFiles(old.path);
  await page.getByText('Exact PDF match · Recorded page 2 of 2').waitFor();
  await page.getByRole('button', { name: 'Confirm earlier relink' }).click();
  await page.getByRole('status').filter({ hasText: 'Earlier revision relinked to the verified PDF' }).waitFor();

  const relinked = await page.evaluate(() => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')));
  assert.equal(relinked.sheets[0].id, manifest.sheets[0].id);
  assert.equal(relinked.sheets[0].filePath, manifest.sheets[0].filePath);
  assert.equal(relinked.sheets[0].page, manifest.sheets[0].page);
  assert.equal(relinked.sheets[0].revision, manifest.sheets[0].revision);
  assert.equal(relinked.sheets[0].sourceSha256, manifest.sheets[0].sourceSha256);
  assert.equal(relinked.sheets[0].history.length, 2);
  assert.equal(relinked.sheets[0].history[0].filePath, 'renamed-old.pdf');
  assert.deepEqual({ ...relinked.sheets[0].history[0], filePath: 'missing-earlier.pdf' }, manifest.sheets[0].history[0]);
  assert.deepEqual(relinked.sheets[0].history[1], manifest.sheets[0].history[1], 'another earlier revision remains unchanged');

  await openPrior.click();
  await page.getByRole('status').filter({ hasText: 'Viewing earlier revision A' }).waitFor();
  const opened = await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    return { name: doc.filePath, page: doc.currentPage, count: doc.pdfDoc?.numPages };
  });
  assert.equal(opened.name, 'renamed-old.pdf');
  assert.equal(opened.page, 2);
  assert.equal(opened.count, 2);
  assert.deepEqual(errors, []);
  console.log('Historical relink smoke passed: missing source, mismatch refusal, verified relink, stable history, page 2 open');
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
