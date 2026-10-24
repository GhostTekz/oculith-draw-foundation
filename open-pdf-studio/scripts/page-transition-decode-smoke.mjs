import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==',
  'base64',
);
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-page-transition-'));
const server = await createServer({ cacheDir: join(directory, '.vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
  const page = await browser.newPage();
  const pending = [];
  await page.route('**/delayed-placeholder-*.png', route => { pending.push(route); });
  const nextRoute = async () => {
    const deadline = Date.now() + 5000;
    while (!pending.length && Date.now() < deadline) await page.waitForTimeout(10);
    assert.ok(pending.length, 'delayed placeholder request did not start');
    return pending.shift();
  };
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  const start = await page.evaluate(async () => {
    const { setThumbnailImage } = await import('/js/solid/stores/panels/thumbnailStore.js');
    const transition = await import('/js/pdf/page-transition.js');
    let canvas = document.getElementById('pdf-canvas');
    if (!canvas) {
      const parent = document.createElement('div');
      parent.style.position = 'relative';
      canvas = document.createElement('canvas');
      canvas.id = 'pdf-canvas';
      parent.append(canvas);
      document.body.append(parent);
    }
    setThumbnailImage(1, { dataURL: '/delayed-placeholder-1.png', width: 1, height: 1 });
    const generation = transition.showPagePlaceholder(1);
    const image = document.getElementById('page-transition-placeholder');
    return { generation, hidden: image.style.display === 'none' };
  });
  assert.equal(start.hidden, true, 'undecoded placeholder must stay hidden');
  await (await nextRoute()).fulfill({ status: 200, contentType: 'image/png', body: png });
  await page.waitForFunction(() => document.getElementById('page-transition-placeholder')?.style.display === 'block');

  const second = await page.evaluate(async () => {
    const { setThumbnailImage } = await import('/js/solid/stores/panels/thumbnailStore.js');
    const transition = await import('/js/pdf/page-transition.js');
    setThumbnailImage(2, { dataURL: '/delayed-placeholder-2.png', width: 1, height: 1 });
    const generation = transition.showPagePlaceholder(2);
    const image = document.getElementById('page-transition-placeholder');
    const hiddenBeforeDecode = image.style.display === 'none';
    transition.hidePagePlaceholder(generation);
    return hiddenBeforeDecode;
  });
  assert.equal(second, true, 'next page must hide the previous thumbnail while decoding');
  await (await nextRoute()).fulfill({ status: 200, contentType: 'image/png', body: png });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#page-transition-placeholder').evaluate(el => el.style.display), 'none',
    'a late image load must not restore a finished placeholder');
  console.log('Page transition decode smoke passed');
} finally {
  await browser?.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
