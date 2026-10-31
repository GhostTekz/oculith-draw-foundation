// Browser smoke check of the floating thumbnail tile (run after `vite build`).
// THUMBNAIL_TILE_SHOTS=<dir> also saves screenshots of the tile.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const probe = createNetServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const shots = process.env.THUMBNAIL_TILE_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });

// A small drawing-like sheet: white page, border, title block and a few lines.
const sheet = (hue) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="170" height="110">
<rect width="170" height="110" fill="#fff"/><rect x="4" y="4" width="162" height="102" fill="none" stroke="#222" stroke-width="1.2"/>
<rect x="128" y="4" width="38" height="102" fill="none" stroke="#222"/><path d="M14 20h100M14 20v70h100V20M40 20v70M14 55h100" stroke="hsl(${hue} 60% 35%)" stroke-width="1.4" fill="none"/>
<path d="M132 90h30M132 96h30" stroke="#444"/></svg>`).toString('base64')}`;

let server;
let browser;
try {
  // Run after the frontend build: the packaged view has no Vite module
  // transforms, just as the installed desktop window does.
  server = await preview({ preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 300, height: 640 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = new Map();
    const emitted = [];
    const invoked = [];
    const closed = [];
    const current = {
      close: async () => { closed.push(true); },
      onMoved: async () => () => {}, onResized: async () => () => {},
      outerPosition: async () => ({ x: 10, y: 20 }), outerSize: async () => ({ width: 300, height: 640 }),
    };
    window.thumbnailTest = {
      emitted, invoked, closed,
      dispatch: (name, payload) => listeners.get(name)?.({ payload }),
    };
    window.__TAURI__ = {
      core: { invoke: async (name) => { invoked.push(name); return name === 'current_window_label' ? 'thumbnail-main' : null; } },
      event: {
        listen: async (name, handler) => { listeners.set(name, handler); return () => listeners.delete(name); },
        emitTo: async (target, name, payload) => { emitted.push({ target, name, payload }); },
      },
      webviewWindow: { WebviewWindow: { getByLabel: async () => ({ setFocus: async () => {}, once: async () => () => {} }) } },
      window: { getCurrentWindow: () => current, currentMonitor: async () => null },
    };
  });
  page.setDefaultTimeout(120_000);
  await page.goto(`http://127.0.0.1:${port}/?view=thumbnails&source=main`,
    { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.getByText('Open a PDF drawing to see its pages here.').waitFor();
  const emittedNamed = (name, test = () => true) => page.evaluate(([n, t]) => window.thumbnailTest.emitted
    .some(event => event.name === n && new Function('p', `return (${t})(p)`)(event.payload)), [name, String(test)]);
  assert.equal(await emittedNamed('thumbnail-view:ready'), true);
  assert.equal(await page.evaluate(() => window.thumbnailTest.invoked.includes('edition_plugins')), false,
    'the view must not discover or run installed add-ons');
  assert.equal(await page.locator('.thumb-tile-bar[data-tauri-drag-region]').count(), 1, 'the title bar drags the window');

  await page.evaluate(() => window.thumbnailTest.dispatch('thumbnail-view:state', {
    source: 'main', docId: 'first', count: 18, activePage: 2, title: 'Riverside-Clinic-Set.pdf',
  }));
  const titles = ['Cover sheet', 'Site plan', 'Ground floor plan', 'Upper floor plan', 'Roof plan', 'Elevations',
    'Sections', 'Wall sections', 'Details', 'Door schedule', 'Lighting plan', 'Power plan', 'Equipment schedules',
    'Plumbing plan', 'Mechanical plan', 'Fire alarm plan', 'Structural plan', 'Foundation plan'];
  const sheets = ['G-001', 'C-101', 'A-101', 'A-102', 'A-103', 'A-201', 'A-301', 'A-302', 'A-501', 'A-601',
    'E-101', 'E-201', 'E-601', 'P-101', 'M-101', 'FA-101', 'S-101', 'S-201'];
  await page.evaluate(([s, t]) => window.thumbnailTest.dispatch('thumbnail-view:info', {
    source: 'main', docId: 'first', info: s.map((sheet, i) => [String(i + 1), sheet, t[i]]),
  }), [sheets, titles]);
  await page.getByRole('option', { name: /C-101/ }).waitFor();
  assert.equal(await emittedNamed('thumbnail-view:range', p => p.docId === 'first' && Array.isArray(p.pages) && p.pages[0] === 1), true);
  const images = Object.fromEntries(sheets.map((_, i) => [i + 1, sheet(i * 23)]));
  await page.evaluate((all) => window.thumbnailTest.dispatch('thumbnail-view:images', {
    source: 'main', docId: 'first', pages: Object.entries(all).map(([page, dataURL]) => ({ page: Number(page), dataURL, width: 170, height: 110 })),
  }), images);
  await page.locator('.thumb-tile-page img').first().waitFor();
  assert.equal(await page.locator('.thumb-tile-page.active .thumb-tile-primary').textContent(), 'C-101');
  if (shots) await page.screenshot({ path: join(shots, 'thumbnail-tile-medium.png') });

  await page.locator('.thumb-tile-page', { hasText: 'A-101' }).click();
  assert.equal(await emittedNamed('thumbnail-view:goto', p => p.docId === 'first' && p.page === 3 && p.focus === true), true);

  // Filter, then Enter opens the first match without leaving the tile.
  await page.getByLabel('Filter pages').fill('elec');
  await page.getByLabel('Filter pages').fill('plan e-');
  assert.deepEqual(await page.locator('.thumb-tile-primary').allTextContents(), ['E-101', 'E-201']);
  await page.getByLabel('Filter pages').press('ArrowDown');
  await page.getByLabel('Filter pages').press('Enter');
  assert.equal(await emittedNamed('thumbnail-view:goto', p => p.page === 12 && p.focus === false), true);
  assert.equal(await page.getByText('2 of 18 pages').count(), 1);
  if (shots) await page.screenshot({ path: join(shots, 'thumbnail-tile-filtered.png') });
  await page.getByLabel('Filter pages').press('Escape');
  assert.equal(await page.getByLabel('Filter pages').inputValue(), '');

  await page.getByRole('radio', { name: 'Small thumbnails' }).click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.thumb-tile-items')).gridTemplateColumns.split(' ').length === 3);
  // The drawing window resends pages the tile asks for again after the filter.
  assert.equal(await emittedNamed('thumbnail-view:range', p => p.pages.length > 12), true);
  await page.evaluate((all) => window.thumbnailTest.dispatch('thumbnail-view:images', {
    source: 'main', docId: 'first', pages: Object.entries(all).map(([page, dataURL]) => ({ page: Number(page), dataURL, width: 170, height: 110 })),
  }), images);
  if (shots) await page.screenshot({ path: join(shots, 'thumbnail-tile-small.png') });

  await page.getByRole('button', { name: 'Dock in the side panel' }).click();
  assert.equal(await emittedNamed('thumbnail-view:dock'), true);
  assert.ok(await page.evaluate(() => window.thumbnailTest.closed.length) >= 1);

  await page.evaluate(() => window.thumbnailTest.dispatch('thumbnail-view:state', {
    source: 'main', docId: '', count: 0, activePage: 0, title: '',
  }));
  await page.getByText('Open a PDF drawing to see its pages here.').waitFor();
  await page.evaluate(() => window.thumbnailTest.dispatch('thumbnail-view:state', {
    source: 'main', docId: 'second', count: 2, activePage: 1, title: 'second.pdf',
  }));
  await page.getByRole('option', { name: 'Page 2' }).waitFor();
  assert.equal(await page.locator('.thumb-tile-page img').count(), 0, 'old document image must not survive reopen');
  assert.equal(await page.getByText('second.pdf').count(), 1);
  assert.equal(await page.locator('.thumb-tile-primary', { hasText: 'C-101' }).count(), 0, 'old captions must not survive');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('Thumbnail tile smoke passed: ready, captions, navigation, filter, sizes, dock, document switch');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
