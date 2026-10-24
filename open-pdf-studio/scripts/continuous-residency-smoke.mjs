import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-continuous-residency-'));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const pageCount = Number(process.env.OCUDRAW_SMOKE_PAGES || 120);
for (let page = 1; page <= pageCount; page++) {
  const size = page % 4 === 0 ? [1200, 900] : [600, 800];
  pdf.addPage(size).drawText(`Page ${page}`, { x: 30, y: size[1] - 40, size: 22, font });
}
const file = join(directory, `${pageCount}-mixed-pages.pdf`);
await writeFile(file, await pdf.save());
const server = await createServer({ root: process.env.OCUDRAW_VITE_ROOT || process.cwd(),
  cacheDir: join(directory, '.vite-cache'),
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
  const milestones = await page.evaluate(async () => {
    const renderer = await import('/js/pdf/renderer.js');
    const started = performance.now();
    const firstUseful = new Promise(resolve => {
      const check = () => {
        const canvas = document.querySelector('#continuous-container .page-wrapper[data-page="1"] canvas.pdf-canvas');
        if (canvas?.width && canvas?.height) {
          const pixels = canvas.getContext('2d').getImageData(0, 0,
            Math.min(150, canvas.width), Math.min(120, canvas.height)).data;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] > 200 && pixels[index] < 100 && pixels[index + 1] < 100) {
              resolve(performance.now() - started);
              return;
            }
          }
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    await renderer.setViewMode('continuous');
    const buildMs = performance.now() - started;
    const usefulMs = await Promise.race([firstUseful, new Promise(resolve => setTimeout(() => resolve(null), 5000))]);
    return { buildMs, usefulMs };
  });
  await page.waitForFunction(expected => document.querySelectorAll('#continuous-container .page-wrapper').length === expected,
    pageCount);
  const sheetSizes = await page.evaluate(() => [1, 4].map(pageNumber => {
    const wrapper = document.querySelector(`#continuous-container .page-wrapper[data-page="${pageNumber}"]`);
    return [Number(wrapper.dataset.baseW), Number(wrapper.dataset.baseH)];
  }));
  assert.ok(sheetSizes[0][1] > sheetSizes[0][0] && sheetSizes[1][0] > sheetSizes[1][1],
    `mixed portrait and landscape sheet dimensions changed: ${JSON.stringify(sheetSizes)}`);

  const samples = [];
  for (const fraction of [0, .25, .5, .75, 1, .5, 0]) {
    await page.locator('#pdf-container').evaluate((el, position) => {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * position;
    }, fraction);
    await page.waitForTimeout(900);
    const sample = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll('#continuous-container .page-wrapper canvas.pdf-canvas')];
      const top = document.querySelector('#continuous-container .page-wrapper[data-page="1"] canvas.pdf-canvas');
      return {
        pagesWithCanvas: canvases.length,
        bytes: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
        firstPageReady: !!top && top.width > 0 && top.height > 0,
        firstPageText: document.querySelector('#continuous-container .page-wrapper[data-page="1"] .textLayer')?.textContent || '',
      };
    });
    samples.push({ fraction, ...sample });
    assert.ok(sample.pagesWithCanvas <= 8, `page surfaces kept growing: ${JSON.stringify(samples)}`);
  }
  assert.ok(samples.at(-1).firstPageReady, 'the first page did not render on return');
  assert.ok(samples.at(-1).firstPageText.includes('Page 1'), 'the first page text did not return');
  const beforeZoomWidth = await page.evaluate(() => parseFloat(document.querySelector(
    '#continuous-container .page-wrapper[data-page="1"] .canvas-container-cont').style.width));
  await page.evaluate(async () => (await import('/js/pdf/renderer.js')).continuousZoomStep(1));
  await page.waitForTimeout(500);
  const afterZoom = await page.evaluate(() => {
    const wrapper = document.querySelector('#continuous-container .page-wrapper[data-page="1"]');
    const canvasContainer = wrapper.querySelector('.canvas-container-cont');
    return {
      actualWidth: parseFloat(canvasContainer.style.width),
      pagesWithCanvas: document.querySelectorAll('#continuous-container .page-wrapper canvas.pdf-canvas').length,
    };
  });
  assert.ok(Math.abs(afterZoom.actualWidth - beforeZoomWidth * 1.25) < 0.01,
    `zoom lost the mixed-sheet dimensions: ${JSON.stringify(afterZoom)}`);
  assert.ok(afterZoom.pagesWithCanvas <= 8, `zoom retained too many page surfaces: ${JSON.stringify(afterZoom)}`);
  console.log(JSON.stringify({ pageCount, buildMs: Math.round(milestones.buildMs),
    usefulMs: milestones.usefulMs == null ? null : Math.round(milestones.usefulMs), samples }));
} finally {
  await browser?.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
