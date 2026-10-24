import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-markups-virtual-'));
const pdf = await PDFDocument.create();
pdf.addPage([600, 800]);
const file = join(directory, 'one-page.pdf');
await writeFile(file, await pdf.save());
const server = await createServer({ cacheDir: join(directory, '.vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => console.log('pageerror', error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.draw-open-button').click();
  await (await chooser).setFiles(file);
  await page.locator('#pdf-container.visible').waitFor();
  if (await page.locator('.ws-access-bottom .ws-access-toggle').getAttribute('aria-expanded') === 'false') {
    await page.locator('.ws-access-bottom .ws-access-toggle').click();
  }
  await page.waitForFunction(() => document.querySelector('#annotations-panel .annotations-list-content')?.clientHeight > 0);
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    const store = await import('/js/solid/stores/panels/annotationsStore.js');
    store.setEmptyMessage('');
    store.setItems([
      { isHeader: true, groupKey: 'fixture', sortMode: 'page', headerLabel: 'Fixture', count: 20_000 },
      ...Array.from({ length: 20_000 }, (_, index) => ({
        isHeader: false, groupKey: 'fixture', id: `virtual-${index}`, page: 1,
        type: 'box', typeLabel: 'Rectangle', subjectLabel: `Row ${index}`,
        author: 'Fixture', selected: false, locked: false, hidden: false,
      })),
    ]);
  });
  await page.waitForFunction(() => document.querySelectorAll('#annotations-panel .annotation-list-item').length > 0);
  const initial = await page.locator('#annotations-panel .annotation-list-item').count();
  assert.ok(initial < 100, `20,000 rows mounted ${initial} DOM rows`);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('ocudraw:reveal-markup-row', {
    detail: { rowId: 'virtual-19999' },
  })));
  await page.waitForFunction(() => !!document.querySelector('#annotations-panel [data-annotation-id="virtual-19999"]'));
  await page.waitForTimeout(250);
  const final = await page.locator('#annotations-panel .annotation-list-item').count();
  const lastPresent = await page.locator('#annotations-panel [data-annotation-id="virtual-19999"]').count();
  const storeCount = await page.evaluate(async () => (await import('/js/solid/stores/panels/annotationsStore.js')).items().length);
  assert.ok(final > 0 && final < 100 && lastPresent === 1,
    `far-row reveal lost the target: ${JSON.stringify({ final, lastPresent, storeCount })}`);
  const penultimate = page.locator('#annotations-panel [data-annotation-id="virtual-19998"]');
  await penultimate.focus();
  await penultimate.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.dataset.annotationId === 'virtual-19999');
  console.log(JSON.stringify({ totalRows: 20_000, initialMounted: initial, farMounted: final, storeCount }));
} finally {
  await browser?.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
