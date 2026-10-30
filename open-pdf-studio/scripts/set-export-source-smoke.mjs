// The drawing log and set manifest must describe the register reviewed before
// a Save dialog, even if the set changes while that dialog is open.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const scratch = await mkdtemp(join(process.env.TMPDIR || process.cwd(), 'set-export-source-'));
const register = { version: 1, name: 'First set', sheets: [
  { id: 'sheet-1', label: 'A-101', title: 'Lobby', revision: 'A',
    filePath: 'drawing.pdf', page: 1, history: [] },
] };
const server = await createServer({ cacheDir: join(scratch, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(value => localStorage.setItem('oculithDraw.sheetRegister.v1', JSON.stringify(value)), register);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle', timeout: 60000 });
  try { await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').waitFor({ timeout: 30000 }); }
  catch (error) { throw new Error(`Sheets panel did not start: ${JSON.stringify({
    errors, url: page.url(), body: (await page.locator('body').innerText()).slice(0, 600),
  })}`, { cause: error }); }
  await page.locator('.ws-host-left .ws-access-tab[data-panel="sheets"]').click();
  await page.evaluate(() => {
    window.__setExportDialogs = [];
    window.__setExportWrites = [];
    window.__TAURI__ = {
      dialog: { save: options => new Promise(resolve => window.__setExportDialogs.push({ options, finish: resolve })) },
      fs: { writeFile: async (path, bytes) => window.__setExportWrites.push({ path, bytes: Array.from(bytes) }) },
    };
  });
  const setName = async name => {
    await page.getByLabel('Set name').fill(name);
    await page.getByLabel('Set name').press('Tab');
    await page.waitForFunction(value => JSON.parse(localStorage.getItem('oculithDraw.sheetRegister.v1')).name === value, name);
  };
  const begin = async (button, count) => {
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.waitForFunction(expected => window.__setExportDialogs.length === expected, count);
  };
  const finish = async path => page.evaluate(value => window.__setExportDialogs.at(-1).finish(value), path);
  const writes = () => page.evaluate(() => window.__setExportWrites);

  await begin('Export drawing log', 1);
  await setName('Second set');
  await finish('first.csv');
  await page.getByRole('status').filter({ hasText: 'changed during export' }).waitFor();
  assert.equal((await writes()).length, 0, 'changed register blocks the stale drawing log');

  await begin('Export set manifest', 2);
  await setName('Third set');
  await finish('second.json');
  await page.getByRole('status').filter({ hasText: 'changed during export' }).waitFor();
  assert.equal((await writes()).length, 0, 'changed register blocks the stale manifest');

  await begin('Export drawing log PDF', 3);
  await setName('Final set');
  await finish('third.pdf');
  await page.getByRole('status').filter({ hasText: 'changed during export' }).waitFor();
  assert.equal((await writes()).length, 0, 'changed register blocks the stale PDF drawing log');

  await begin('Export drawing log', 4);
  await finish('current.csv');
  await page.waitForFunction(() => window.__setExportWrites.length === 1);
  assert.match(new TextDecoder().decode(Uint8Array.from((await writes())[0].bytes)), /A-101/);

  await begin('Export set manifest', 5);
  await finish('current.json');
  await page.waitForFunction(() => window.__setExportWrites.length === 2);
  assert.equal(JSON.parse(new TextDecoder().decode(Uint8Array.from((await writes())[1].bytes))).name, 'Final set');

  await begin('Export drawing log PDF', 6);
  await finish('current.pdf');
  await page.waitForFunction(() => window.__setExportWrites.length === 3);
  assert.match(new TextDecoder().decode(Uint8Array.from((await writes())[2].bytes.slice(0, 8))), /^%PDF-/);

  await begin('Export set manifest', 7);
  await finish(null);
  assert.equal((await writes()).length, 3, 'cancel does not write');
  assert.deepEqual(errors, []);
  console.log('Drawing-set export smoke passed: changed CSV, manifest and PDF refused; stable exports and cancel passed.');
} finally {
  await browser.close();
  await server.close();
  await rm(scratch, { recursive: true, force: true });
}
