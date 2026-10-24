import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-thumbnail-scroll-'));
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let page = 1; page <= 536; page++) {
  const size = page % 4 === 0 ? [3024, 2160] : [400, 800];
  pdf.addPage(size).drawText(`Page ${page}`, { x: 30, y: size[1] - 40, size: 22, font });
}
const file = join(directory, '536-pages.pdf');
await writeFile(file, await pdf.save());
const server = await createServer({ cacheDir: join(directory, '.vite-cache'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
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
  await page.locator('.ws-access-tab[data-panel="thumbnails"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#thumbnails-panel .thumbnail-item[data-page]').length > 0);
  for (const fraction of [0, .1, .2, .5, .8, 1, .8, .5, .2, 0]) {
    await page.locator('#thumbnails-container').evaluate((el, fraction) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction; }, fraction);
    await page.waitForTimeout(1000);
    const data = await page.locator('#thumbnails-container').evaluate(el => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      maxImageWidth: Math.max(0, ...[...el.querySelectorAll('.thumbnail-item[data-page] img')]
        .map(img => img.getBoundingClientRect().width)),
      imageCoverage: [...el.querySelectorAll('.thumbnail-item[data-page] img')].reduce((total, img) => {
        const image = img.getBoundingClientRect();
        const viewport = el.getBoundingClientRect();
        return total + Math.max(0, Math.min(image.bottom, viewport.bottom) - Math.max(image.top, viewport.top));
      }, 0),
    }));
    assert.ok(data.imageCoverage > data.clientHeight * .35,
      `thumbnail images disappeared at scroll ${fraction}: ${JSON.stringify(data)}`);
    assert.ok(data.maxImageWidth <= 140,
      `construction sheet thumbnail exceeded its 140px target: ${JSON.stringify(data)}`);
  }
  const transition = await page.evaluate(async () => {
    const { thumbnailData } = await import('/js/solid/stores/panels/thumbnailStore.js');
    const { showPagePlaceholder, hidePagePlaceholder } = await import('/js/pdf/page-transition.js');
    if (!thumbnailData['1']?.dataURL) return { missingThumbnail: true };
    const gen = showPagePlaceholder(1);
    const image = document.getElementById('page-transition-placeholder');
    try { await image.decode(); } catch { /* reported by naturalWidth */ }
    const loaded = image.naturalWidth > 0 && image.src.startsWith('data:image/');
    showPagePlaceholder(9999);
    const staleHidden = image.style.display === 'none';
    hidePagePlaceholder(gen);
    return { loaded, staleHidden };
  });
  assert.deepEqual(transition, { loaded: true, staleHidden: true });
  console.log('536-page thumbnail scroll smoke passed');
} finally {
  await browser?.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
