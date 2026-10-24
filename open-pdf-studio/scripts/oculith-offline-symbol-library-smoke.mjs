import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const upstreamRequests = [];
  const errors = [];
  page.on('request', request => {
    if (/github\.com\/.*OpenAEC-Foundation\/open-pdf-studio-library/i.test(request.url())) {
      upstreamRequests.push(request.url());
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await context.setOffline(true);

  await page.locator('.sp-docked .sp-settings-btn').click();
  const dialog = page.locator('.sp-settings-dialog');
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /Oculith/i);
  await dialog.getByPlaceholder('New group name...').fill('Local review symbols');
  await dialog.getByRole('button', { name: 'Add Group' }).click();
  await dialog.locator('.sp-settings-group-name', { hasText: 'Local review symbols' }).waitFor();

  await context.setOffline(false);
  await page.reload({ waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.locator('.sp-docked .sp-settings-btn').click();
  await page.locator('.sp-settings-group-name', { hasText: 'Local review symbols' }).waitFor();
  assert.deepEqual(upstreamRequests, []);
  assert.deepEqual(errors, []);
  console.log('Offline symbol library smoke passed: local group survives reload without upstream requests');
} finally {
  await browser?.close();
  await server?.close();
}
