import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const pdf = await PDFDocument.create();
pdf.addPage([612, 792]);
const bytes = Array.from(await pdf.save());
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
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('markups.pdf');
    await loadPDF('markups.pdf', index, Uint8Array.from(content));
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    doc.annotations.push({ id: 'one', page: 1, type: 'comment', author: 'Alex', subject: 'Door', status: 'accepted', text: 'Verify clearance', createdAt: '2026-10-01', modifiedAt: '2026-10-02' });
    doc.annotations.push({ id: 'two', page: 1, type: 'comment', author: 'Pat', subject: 'Wall', text: 'Check detail', createdAt: '2026-10-01', modifiedAt: '2026-10-02' });
    doc.selectedAnnotation = doc.annotations[0];
    doc.selectedAnnotations = [doc.annotations[0]];
    const { switchLeftPanelTab } = await import('/js/ui/panels/left-panel.js');
    switchLeftPanelTab('annotations');
    const { updateAnnotationsList } = await import('/js/ui/panels/annotations-list.js');
    updateAnnotationsList();
  }, bytes);
  const menu = page.locator('#annotations-panel .annotations-toolbar-btn').first();
  await menu.click();
  const allDownload = page.waitForEvent('download');
  await page.getByText('Export Comments to Data File... (CSV)').click();
  const all = (await readFile(await (await allDownload).path())).toString('utf8');
  assert.match(all, /Verify clearance/u);
  assert.match(all, /Check detail/u);
  await menu.click();
  const selectedDownload = page.waitForEvent('download');
  await page.getByText('Export Selected Comments to Data File... (CSV)').click();
  const selected = (await readFile(await (await selectedDownload).path())).toString('utf8');
  assert.match(selected, /Verify clearance/u);
  assert.doesNotMatch(selected, /Check detail/u);
  assert.deepEqual(errors, []);
  console.log('Markup CSV smoke passed: all and selected downloads');
} finally {
  await browser?.close();
  await server?.close();
}
