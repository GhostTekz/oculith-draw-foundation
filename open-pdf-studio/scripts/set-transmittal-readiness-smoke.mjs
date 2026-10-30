import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-transmittal-'));
const pdf = await PDFDocument.create();
for (const label of ['A-101', 'A-102', 'A-103']) pdf.addPage([612, 792]).drawText(label);
const bytes = new Uint8Array(await pdf.save());
const hash = createHash('sha256').update(bytes).digest('hex');
const differentHash = 'a'.repeat(64) === hash ? 'b'.repeat(64) : 'a'.repeat(64);
const register = { version: 1, name: 'Transmittal review', sheets: [
  { id: 'ready-one', label: 'A-101', title: 'First', revision: 'B', filePath: 'Set.pdf', page: 1,
    sourceSha256: hash, history: [] },
  { id: 'ready-two', label: 'A-102', title: 'Second', revision: 'B', filePath: 'Set.pdf', page: 2,
    sourceSha256: hash, history: [] },
  { id: 'unverified', label: 'A-103', title: 'Third', revision: '', filePath: 'Set.pdf', page: 3,
    history: [] },
  { id: 'changed', label: 'A-104', title: 'Fourth', revision: 'A', filePath: 'Set.pdf', page: 4,
    sourceSha256: differentHash, history: [] },
  { id: 'missing', label: 'A-105', title: 'Fifth', revision: 'A', filePath: 'Missing.pdf', page: 1,
    sourceSha256: hash, history: [] },
] };
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify(value)), register);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async data => {
    (await import('/js/core/platform.js')).cacheWebFile('Set.pdf', Uint8Array.from(data));
  }, Array.from(bytes));
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  await page.getByRole('button', { name: 'Check transmittal readiness' }).click();
  const review = page.getByLabel('Transmittal readiness review');
  await review.getByText('Current sheet source readiness · 2 of 5 ready').waitFor();
  const text = await review.innerText();
  assert.match(text, /A-101[\s\S]*Source ready/u);
  assert.match(text, /A-102[\s\S]*Source ready/u);
  assert.match(text, /A-103[\s\S]*No recorded SHA-256[\s\S]*Use Add PDFs/u);
  assert.match(text, /A-104[\s\S]*Changed PDF bytes[\s\S]*Choose revised PDF[\s\S]*Recorded page 4 is outside this PDF \(3 pages\)/u);
  assert.match(text, /A-105[\s\S]*Missing or inaccessible PDF[\s\S]*Relink/u);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'))), register);
  const unchanged = await page.evaluate(async () => {
    const { readBinaryFile } = await import('/js/core/platform.js');
    return Array.from(await readBinaryFile('Set.pdf'));
  });
  assert.deepEqual(unchanged, Array.from(bytes));
  assert.deepEqual(errors, []);
  console.log('Transmittal readiness acceptance passed: exact and shared PDF sources, actionable issues, unchanged register and bytes.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
