import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, rgb } from 'pdf-lib';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';

const oldPdf = await PDFDocument.create();
oldPdf.addPage([612, 792]).drawRectangle({ x: 100, y: 600, width: 80, height: 80,
  color: rgb(0, 0, 0) });
const newPdf = await PDFDocument.create();
newPdf.addPage([612, 792]);
const oldBytes = Array.from(await oldPdf.save());
const newBytes = Array.from(await newPdf.save());
const cacheDir = join(tmpdir(), 'compare-visible-overlay-vite');
const server = await createServer({ cacheDir,
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async ({ oldBytes, newBytes }) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    for (const [name, bytes] of [['earlier.pdf', oldBytes], ['current.pdf', newBytes]]) {
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(bytes));
    }
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const [oldDoc, newDoc] = state.documents.filter(doc => doc?.filePath && doc?.pdfDoc).slice(-2);
    compare.startCompare({ oldFilePath: oldDoc.filePath, newFilePath: newDoc.filePath,
      mode: 'overlay' });
  }, { oldBytes, newBytes });
  const oldCanvas = page.locator('.compare-old-layer canvas');
  await page.waitForFunction(() => {
    const old = document.querySelector('.compare-old-layer canvas');
    return old?.width > 900 && old.getContext('2d').getImageData(180, 200, 1, 1).data[0] < 30;
  });
  await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    compare.setCompareShowBox(false);
    compare.setCompareShowContour(false);
  });
  const slider = page.getByRole('slider', { name: 'Earlier page opacity' });
  const sample = async (x = 180, y = 200) => {
    const rect = await page.locator('.compare-old-layer').locator('..').boundingBox();
    assert.ok(rect, 'visible page layer has screen geometry');
    const png = await page.screenshot();
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const px = Math.round(rect.x + x);
    const py = Math.round(rect.y + y);
    return data[(py * info.width + px) * info.channels];
  };
  await slider.fill('0');
  assert.ok(await sample() > 245, '0% reveals the new white page');
  await slider.fill('50');
  const half = await sample();
  assert.ok(half > 90 && half < 170, `50% blends earlier ink (red channel ${half})`);
  await slider.fill('100');
  const full = await sample();
  assert.ok(full < 30, `100% shows the earlier black ink (red channel ${full})`);

  await page.locator('.compare-toolbar input[type="number"]').first().fill('80');
  await page.waitForFunction(async () => {
    const compare = await import('/js/compare/compare-store.js');
    return compare.compareOffset().dx === 80 && !compare.compareDetecting();
  });
  assert.ok(await sample(160, 200) > 245, 'alignment clears the former ink position');
  assert.ok(await sample(260, 200) < 30, 'alignment moves earlier ink onto the new page');
  const before = await page.locator('.compare-old-layer').evaluate(el =>
    Number(new DOMMatrix(getComputedStyle(el).transform).m41.toFixed(2)));
  const initialZoom = await page.evaluate(async () =>
    (await import('/js/compare/compare-store.js')).compareZoom());
  const previewScale = await page.locator('.compare-old-layer').locator('..').evaluate(el =>
    getComputedStyle(el).transform);
  assert.ok(Math.abs(before - 80 * initialZoom) < 0.1,
    `visible alignment scales from the fixed drawing coordinate (${before}, zoom ${initialZoom}, preview ${previewScale})`);
  await page.evaluate(async () => (await import('/js/compare/compare-store.js')).setCompareZoom(2));
  await page.waitForFunction(() => document.querySelector('.compare-old-layer canvas')?.width > 1800);
  await page.waitForFunction(() => {
    const transform = getComputedStyle(document.querySelector('.compare-old-layer')).transform;
    return /160(?:\.0+)?[, ]/.test(transform);
  });
  assert.equal(await slider.inputValue(), '100', 'zoom preserves the opacity setting');
  assert.ok(await oldCanvas.evaluate(canvas => canvas.width > 1800));
  assert.deepEqual(errors, []);
  console.log('Visible Compare overlay smoke passed: real PDF pixels, opacity, alignment, zoom');
} finally {
  await browser?.close();
  await server.close();
}
