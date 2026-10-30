import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { preview } from 'vite';

const probe = createNetServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));

let server;
let browser;
try {
  // Run after the frontend build: the packaged view has no Vite module
  // transforms, just as the installed desktop window does.
  server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 260, height: 680 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Map();
    const emitted = [];
    const invoked = [];
    window.thumbnailTest = {
      emitted,
      invoked,
      dispatch: (name, payload) => listeners.get(name)?.({ payload }),
    };
    window.__TAURI__ = {
      core: { invoke: async (name) => { invoked.push(name); return name === 'current_window_label' ? 'thumbnail-main' : null; } },
      event: {
        listen: async (name, handler) => { listeners.set(name, handler); return () => listeners.delete(name); },
        emitTo: async (target, name, payload) => { emitted.push({ target, name, payload }); },
      },
      webviewWindow: { WebviewWindow: { getByLabel: async () => ({ setFocus: async () => {} }) } },
      window: { getCurrentWindow: () => ({ close: async () => {} }) },
    };
  });
  page.setDefaultTimeout(120_000);
  await page.goto(`http://127.0.0.1:${port}/?view=thumbnails&source=main`,
    { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.getByText('Open a PDF drawing to see its pages here.').waitFor();
  assert.equal(await page.evaluate(() => window.thumbnailTest.emitted.some(event => event.name === 'thumbnail-view:ready')), true);
  assert.equal(await page.evaluate(() => window.thumbnailTest.invoked.includes('edition_plugins')), false,
    'the view must not discover or run installed add-ons');

  await page.evaluate(() => window.thumbnailTest.dispatch('thumbnail-view:state', {
    source: 'main', docId: 'first', count: 6, activePage: 2, title: 'first.pdf',
  }));
  await page.getByRole('option', { name: 'Page 6' }).waitFor();
  await page.getByRole('option', { name: 'Page 3' }).click();
  assert.equal(await page.evaluate(() => window.thumbnailTest.emitted.some(event =>
    event.name === 'thumbnail-view:goto' && event.payload.docId === 'first' && event.payload.page === 3)), true);
  const red = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9wAAAABJRU5ErkJggg==';
  await page.evaluate((dataURL) => window.thumbnailTest.dispatch('thumbnail-view:images', {
    source: 'main', docId: 'first', pages: [{ page: 3, dataURL, width: 1, height: 1 }],
  }), red);
  await page.getByRole('option', { name: 'Page 3' }).locator('img').waitFor();

  await page.evaluate(() => window.thumbnailTest.dispatch('thumbnail-view:state', {
    source: 'main', docId: '', count: 0, activePage: 0, title: '',
  }));
  await page.getByText('Open a PDF drawing to see its pages here.').waitFor();
  await page.evaluate(() => window.thumbnailTest.dispatch('thumbnail-view:state', {
    source: 'main', docId: 'second', count: 2, activePage: 1, title: 'second.pdf',
  }));
  await page.getByRole('option', { name: 'Page 2' }).waitFor();
  assert.equal(await page.locator('.detached-thumbnail img').count(), 0, 'old document image must not survive reopen');
  assert.equal(await page.getByText('second.pdf').count(), 1);
  assert.deepEqual(errors, []);
  console.log('Detached thumbnail view smoke passed: ready, navigation, images, document close/reopen');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
