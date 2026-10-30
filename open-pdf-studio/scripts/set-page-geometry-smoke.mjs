import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-geometry-'));
const pdf = await PDFDocument.create();
const first = pdf.addPage([612, 792]);
first.setCropBox(36, 72, 540, 648);
first.setRotation(degrees(90));
pdf.addPage([1224, 792]);
const bytes = new Uint8Array(await pdf.save());
const hash = createHash('sha256').update(bytes).digest('hex');
const register = { version: 1, name: 'Geometry review', sheets: [
  { id: 'first', label: 'A-101', title: 'First', filePath: 'Set.pdf', page: 1,
    sourceSha256: hash, history: [] },
  { id: 'second', label: 'A-102', title: 'Second', filePath: 'Set.pdf', page: 2,
    sourceSha256: hash, history: [] },
  { id: 'missing', label: 'A-103', title: 'Missing', filePath: 'Missing.pdf', page: 1,
    sourceSha256: hash, history: [] },
] };
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
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
  await page.getByRole('button', { name: 'Check page geometry' }).click();
  const audit = page.locator('.sheets-revision-summary').filter({ hasText: 'Current registered pages' });
  await audit.getByText('Displayed 9.00 × 7.50 in · Rotation 90°').waitFor();
  const text = await audit.innerText();
  assert.match(text, /A-101[\s\S]*Verified[\s\S]*Crop/u);
  assert.match(text, /A-102[\s\S]*Verified[\s\S]*Displayed 17.00 × 11.00 in/u);
  assert.match(text, /A-103[\s\S]*Missing PDF/u);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('oculithDraw.sheetRegister.v1'))), register);
  assert.deepEqual(errors, []);
  console.log('Page geometry acceptance passed: verified dimensions, box differences, missing source, unchanged register.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
