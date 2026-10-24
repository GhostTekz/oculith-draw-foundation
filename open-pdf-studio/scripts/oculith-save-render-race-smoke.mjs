import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-save-render-'));
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const result = await page.evaluate(async () => {
    const source = await import('/js/pdf/source-render-revision.js');
    const bitmaps = await import('/js/pdf/page-bitmap-cache.js');
    const tiles = await import('/js/pdf/tile-cache.js');
    const path = '/tmp/held-save-render.pdf';
    const bytes = color => {
      const out = new Uint8Array(12);
      new DataView(out.buffer).setUint32(0, 1, true);
      new DataView(out.buffer).setUint32(4, 1, true);
      out.set(color, 8);
      return out;
    };
    const releases = [];
    window.__TAURI__ = { core: { invoke: async command => {
      if (command !== 'render_pdf_page') throw new Error(`Unexpected ${command}`);
      return new Promise(resolve => { releases.push(() => resolve(bytes([255, 0, 0, 255]))); });
    } } };
    const pending = bitmaps.ensureBitmap(path, 1, 0, 1);
    const pendingAfterFinish = bitmaps.ensureBitmap(path, 1, 0, 2);
    for (let i = 0; i < 100 && releases.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 1));
    if (releases.length !== 2) throw new Error('Held full-page IPC was not requested twice');
    const oldRevision = source.sourceRenderRevision(path);
    const finish = source.beginSourceWrite(path);
    bitmaps.invalidateDocumentBitmaps(path);
    tiles.tileCacheClearForFile(path);
    releases[0]();
    const old = await pending;
    const oldCached = bitmaps.getCachedBitmap(path, 1, 0, 1);
    const duringWrite = await bitmaps.ensureBitmap(path, 1, 0, 1);
    finish();
    releases[1]();
    const lateOld = await pendingAfterFinish;
    window.__TAURI__.core.invoke = async () => bytes([0, 0, 255, 255]);
    const fresh = await bitmaps.ensureBitmap(path, 1, 0, 1);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.drawImage(fresh.bitmap, 0, 0);
    const freshPixel = Array.from(context.getImageData(0, 0, 1, 1).data);

    const tileRevision = source.sourceRenderRevision(path);
    const originalCreate = window.createImageBitmap;
    let releaseTile;
    window.createImageBitmap = input => new Promise(resolve => {
      releaseTile = async () => resolve(await originalCreate(input));
    });
    try {
      const redTile = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
      const tilePending = tiles.tileCacheSet(path, 1, 1, 0, '0,0', redTile,
        { regionXpt: 0, regionYpt: 0, regionWpt: 1, regionHpt: 1, renderScale: 1 }, tileRevision);
      const finishTileWrite = source.beginSourceWrite(path);
      tiles.tileCacheClearForFile(path);
      await releaseTile();
      await tilePending;
      const staleTile = tiles.tileCacheGet(path, 1, 1, 0, '0,0');
      finishTileWrite();
      return { oldWasRejected: old === null && oldCached === null && duringWrite === null,
        postFinishOldRejected: lateOld === null && bitmaps.getCachedBitmap(path, 1, 0, 2) === null,
        oldRevisionRejected: !source.sourceRenderCurrent(path, oldRevision),
        freshPixel, staleTileRejected: staleTile === null };
    } finally {
      window.createImageBitmap = originalCreate;
    }
  });
  assert.equal(result.oldWasRejected, true);
  assert.equal(result.postFinishOldRejected, true);
  assert.equal(result.oldRevisionRejected, true);
  assert.deepEqual(result.freshPixel, [0, 0, 255, 255]);
  assert.equal(result.staleTileRejected, true);
  assert.deepEqual(errors, []);
  console.log('Held page responses released during and after save, and a held tile, were rejected; fresh pixels rendered.');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
