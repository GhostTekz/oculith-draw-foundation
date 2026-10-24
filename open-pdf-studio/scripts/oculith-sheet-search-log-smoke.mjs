import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer } from 'vite';

let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify({
    version: 1, name: 'Level 1 drawings', sheets: [
      { id: 'stable-a101', label: 'A-101', title: 'Lobby', revision: 'B', filePath: 'revised.pdf', page: 3,
        history: [{ revision: 'P0', filePath: 'old.pdf', page: 1, replacedAt: '2026-10-13T10:00:00Z' }] },
      { id: 'stable-m201', label: 'M-201', title: 'Mechanical room', revision: 'C', filePath: 'mechanical.pdf', page: 2, history: [] },
      { id: 'stable-e301', label: 'E-301', title: 'Electrical room', revision: 'B', filePath: 'electrical.pdf', page: 1, history: [] },
    ],
  })));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('#left-panel .left-panel-tab[data-panel="sheets"]').click();
  const rows = page.locator('#sheets-panel .sheets-row');
  assert.equal(await rows.count(), 3);
  await page.getByLabel('Search sheets').fill('lobby');
  assert.equal(await rows.count(), 1);
  assert.match(await rows.first().innerText(), /A-101/);
  await page.getByLabel('Search sheets').fill('p0');
  assert.equal(await rows.count(), 1);
  assert.match(await rows.first().innerText(), /A-101/);
  await page.getByLabel('Filter current revision').selectOption('C');
  assert.equal(await rows.count(), 0);
  assert.match(await page.locator('.sheets-empty').innerText(), /No sheets match/);
  await page.getByLabel('Search sheets').fill('');
  assert.equal(await rows.count(), 1);
  assert.match(await rows.first().innerText(), /M-201/);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export drawing log', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'Level 1 drawings.csv');
  const csv = await readFile(await download.path(), 'utf8');
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 5);
  assert.match(lines[1], /"stable-a101","A-101","Lobby","Current","B","3","revised\.pdf"/);
  assert.match(lines[2], /"stable-a101","A-101","Lobby","Prior","P0","1","old\.pdf"/);
  assert.match(lines[3], /"stable-m201"/);
  assert.match(lines[4], /"stable-e301"/);

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export drawing log PDF' }).click();
  const pdf = await pdfDownload;
  assert.equal(pdf.suggestedFilename(), 'Level 1 drawings-drawing-log.pdf');
  const task = getDocument({ data: new Uint8Array(await readFile(await pdf.path())), useSystemFonts: false });
  const reader = await task.promise;
  const text = (await (await reader.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
  assert.match(text, /Stable sheet ID: stable-a101/u);
  assert.match(text, /Current \| Revision B \| Page 3/u);
  assert.match(text, /Earlier \| Revision P0 \| Page 1/u);
  await task.destroy();
  assert.deepEqual(errors, []);
  console.log('Sheet search and CSV/PDF drawing log smoke passed');
} finally {
  await browser?.close();
  await server?.close();
}
