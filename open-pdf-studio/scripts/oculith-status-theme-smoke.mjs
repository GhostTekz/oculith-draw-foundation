import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'oculith-status-'));
const pdfPath = join(directory, 'status-check.pdf');
const pdf = await PDFDocument.create();
pdf.addPage([612, 792]);
await writeFile(pdfPath, await pdf.save());

let server;
let browser;
try {
  const probe = createNetServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(() => import('/js/pdf/loader.js').then(() => true));

  const chooser = page.waitForEvent('filechooser');
  await page.locator('.draw-open-button').click();
  await (await chooser).setFiles(pdfPath);
  await page.locator('#pdf-container.visible').waitFor({ timeout: 15000 });
  await page.locator('#nav-page-input').waitFor();
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { reportActiveEngine } = await import('/js/solid/stores/engineStatusStore.js');
    const doc = state.documents[state.activeDocumentIndex];
    reportActiveEngine('scene', doc.filePath, doc.currentPage);
  });
  await page.locator('.status-engine--scene').waitFor();
  await page.locator('#nav-page-input').focus();
  await page.keyboard.press('Tab');

  for (const theme of [
    { name: 'default', chrome: 'rgb(13, 13, 16)', text: 'rgb(138, 138, 147)', value: 'rgb(245, 245, 244)', active: 'rgba(255, 122, 0, 0.12)', input: 'rgb(23, 23, 28)', ink: 'rgb(255, 160, 77)', ok: 'rgb(143, 230, 180)', focus: 'rgb(255, 176, 102)' },
    { name: 'light', chrome: 'rgb(228, 226, 222)', text: 'rgb(102, 101, 109)', value: 'rgb(24, 23, 26)', active: 'rgba(255, 122, 0, 0.12)', input: 'rgb(255, 255, 255)', ink: 'rgb(179, 82, 0)', ok: 'rgb(23, 112, 63)', focus: 'rgb(217, 101, 0)' },
  ]) {
    await page.evaluate(name => document.documentElement.setAttribute('data-theme', name), theme.name);
    const styles = await page.evaluate(() => {
      const css = selector => getComputedStyle(document.querySelector(selector));
      return {
        chrome: css('.status-bar').backgroundColor,
        height: css('.status-bar').height,
        text: css('.status-bar').color,
        value: css('#status-hint').color,
        active: css('.status-snap-toggle.active').backgroundColor,
        activeIcon: css('.status-snap-toggle.active svg').stroke,
        navChrome: css('.nav-bar').backgroundColor,
        navHeight: css('.nav-bar').height,
        navActive: css('.nav-btn.active').backgroundColor,
        input: css('#nav-page-input').backgroundColor,
        engine: css('.status-engine--scene').color,
        focusVisible: document.activeElement?.matches(':focus-visible'),
        focusInBar: document.activeElement?.closest('.nav-bar') !== null,
        focusOnNav: document.activeElement?.matches('.nav-btn, .nav-zoom-input, .nav-scale'),
        focus: getComputedStyle(document.activeElement).outlineColor,
        canvas: css('#pdf-canvas').backgroundColor,
      };
    });
    assert.equal(styles.chrome, theme.chrome, `${theme.name} status chrome`);
    assert.equal(styles.height, '30px', 'the external editor status height (30 px deviation)');
    assert.equal(styles.navChrome, theme.chrome, `${theme.name} navigation bar chrome`);
    assert.equal(styles.navHeight, '34px', 'navigation bar height');
    assert.equal(styles.navActive, theme.active, `${theme.name} selected page layout`);
    assert.equal(styles.text, theme.text, `${theme.name} status label`);
    assert.equal(styles.value, theme.value, `${theme.name} status value`);
    assert.equal(styles.active, theme.active, `${theme.name} pressed drawing aid`);
    assert.equal(styles.activeIcon, theme.ink, `${theme.name} selected accent`);
    assert.equal(styles.input, theme.input, `${theme.name} page input`);
    assert.equal(styles.engine, theme.ok, `${theme.name} engine tone`);
    assert.equal(styles.focusInBar, true);
    assert.equal(styles.focusOnNav, true, 'Tab moves from the page field to the next enabled navigation control');
    assert.equal(styles.focusVisible, true, `${theme.name} keyboard focus`);
    assert.equal(styles.focus, theme.focus, `${theme.name} focus ring`);
    assert.equal(styles.canvas, 'rgb(255, 255, 255)', 'PDF page remains neutral');
  }

  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const { reportActiveEngine } = await import('/js/solid/stores/engineStatusStore.js');
    const doc = state.documents[state.activeDocumentIndex];
    reportActiveEngine('vector', doc.filePath, doc.currentPage);
  });
  await page.locator('.status-engine--vector').waitFor();
  assert.equal(await page.locator('.status-engine--vector').evaluate(el => getComputedStyle(el).color), 'rgb(31, 111, 184)');

  assert.deepEqual(errors, []);
  console.log('Oculith status theme smoke passed: dark, warm light, keyboard focus, neutral PDF canvas');
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
