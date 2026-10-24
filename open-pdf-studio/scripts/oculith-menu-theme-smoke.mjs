import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { createServer } from 'vite';

let server;
let browser;
try {
  const probe = createNetServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.locator('#file-tab').click();
  await page.locator('.app-menu-overlay.visible').waitFor();
  await page.locator('.app-menu-back').focus();
  await page.keyboard.press('Tab');

  for (const theme of [
    { name: 'default', menu: 'rgb(17, 17, 21)', sidebar: 'rgb(13, 13, 16)', selected: 'rgb(38, 38, 46)', ink: 'rgb(255, 160, 77)', focus: 'rgb(255, 176, 102)' },
    { name: 'light', menu: 'rgb(246, 245, 243)', sidebar: 'rgb(251, 250, 249)', selected: 'rgb(230, 228, 224)', ink: 'rgb(179, 82, 0)', focus: 'rgb(217, 101, 0)' },
  ]) {
    await page.evaluate(name => document.documentElement.setAttribute('data-theme', name), theme.name);
    await page.waitForTimeout(160); // menu rows animate their background for 100 ms
    const styles = await page.evaluate(() => {
      const css = selector => getComputedStyle(document.querySelector(selector));
      return {
        menu: css('.app-menu-overlay').backgroundColor,
        sidebar: css('.app-menu-sidebar').backgroundColor,
        top: css('.app-menu-overlay').top,
        selected: css('.app-menu-item.active').backgroundColor,
        selectedBorder: css('.app-menu-item.active').borderLeftColor,
        navSelected: css('.open-panel-nav-item.active').backgroundColor,
        navInk: css('.open-panel-nav-item.active').color,
        focusedInMenu: document.activeElement?.closest('.app-menu-overlay') !== null,
        focusVisible: document.activeElement?.matches(':focus-visible'),
        focus: getComputedStyle(document.activeElement).outlineColor,
        canvas: css('#pdf-canvas').backgroundColor,
      };
    });
    assert.equal(styles.menu, theme.menu, `${theme.name} menu surface`);
    assert.equal(styles.sidebar, theme.sidebar, `${theme.name} sidebar chrome`);
    assert.equal(styles.top, '38px', 'menu starts below title bar');
    assert.equal(styles.selected, theme.selected, `${theme.name} selected item`);
    assert.equal(styles.selectedBorder, theme.ink, `${theme.name} selected accent`);
    assert.equal(styles.navSelected, theme.selected, `${theme.name} selected sub-navigation`);
    assert.equal(styles.navInk, theme.ink, `${theme.name} sub-navigation ink`);
    assert.equal(styles.focusedInMenu, true, `${theme.name} focus stays in menu`);
    assert.equal(styles.focusVisible, true, `${theme.name} keyboard focus is visible`);
    assert.equal(styles.focus, theme.focus, `${theme.name} focus ring`);
    assert.equal(styles.canvas, 'rgb(255, 255, 255)', 'PDF page remains neutral');
  }

  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  const rtl = await page.locator('.app-menu-item.active').evaluate(el => {
    const style = getComputedStyle(el);
    return { left: style.borderLeftWidth, right: style.borderRightColor };
  });
  assert.equal(rtl.left, '0px');
  assert.equal(rtl.right, 'rgb(179, 82, 0)');
  assert.deepEqual(errors, []);
  console.log('Oculith menu theme smoke passed: dark, warm light, focus, RTL, neutral canvas');
} finally {
  await browser?.close();
  await server?.close();
}
