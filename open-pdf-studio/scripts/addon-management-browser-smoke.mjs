// UI proof for the generic, offline package-management controls. Native file
// verification and transaction behavior are covered by Rust tests.
import assert from 'node:assert/strict';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

process.env.OCUDRAW_EDITION = 'community';
const temp = await mkdtemp(join(tmpdir(), 'draw-addon-manager-'));
const tcp = createTcpServer();
await new Promise((resolve, reject) => tcp.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = tcp.address().port;
await new Promise((resolve) => tcp.close(resolve));
const server = await createServer({ cacheDir: join(temp, 'vite-cache'),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });

try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__addonManagerCalls = [];
    let rows = [];
    let edition = null;
    window.__TAURI__ = {
      core: { invoke: async (name, args) => {
        if (name === 'edition_plugins') return [];
        if (name === 'addon_packages_list') return rows.map((row) => ({ ...row }));
        if (name === 'addon_edition_info') return edition && { ...edition };
        if (name === 'addon_opened_files_take') return [];
        if (name === 'addon_install_folder') {
          window.__addonManagerCalls.push({ name, args });
          if (args.source !== '/picked/package') throw new Error('Wrong package folder');
          rows = [{ id: 'sample.tools', version: '1.0.0', enabled: true, valid: true }];
          return { id: 'sample.tools', version: '1.0.0', kind: 'package' };
        }
        if (name === 'addon_file_install') {
          window.__addonManagerCalls.push({ name, args });
          if (args.source !== '/picked/sample.ocaddon') throw new Error('Wrong add-on file');
          edition = { id: 'sample.edition', version: '2.0.0', valid: true };
          return [{ id: 'sample.edition', version: '2.0.0', kind: 'edition' }];
        }
        if (name === 'addon_edition_remove') {
          window.__addonManagerCalls.push({ name, args });
          edition = null;
          return true;
        }
        if (name === 'addon_package_set_enabled') {
          window.__addonManagerCalls.push({ name, args });
          rows = rows.map((row) => row.id === args.id ? { ...row, enabled: args.enabled } : row);
          return null;
        }
        if (name === 'addon_package_remove') {
          window.__addonManagerCalls.push({ name, args });
          rows = rows.filter((row) => row.id !== args.id);
          return null;
        }
        return null;
      } },
      dialog: {
        open: async (options) => {
          if (options.directory) return '/picked/package';
          window.__addonManagerCalls.push({ name: 'pick-file', args: options.filters });
          return '/picked/sample.ocaddon';
        },
        ask: async () => true,
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title === 'Oculith Draw Foundation', null, { timeout: 60_000 });
  await page.evaluate(() => import('/js/solid/stores/dialogStore.js').then((module) => module.openDialog('extensions')));
  const section = page.getByRole('region', { name: 'Local add-ons' });
  await section.waitFor();
  assert.match(await section.textContent(), /No local add-ons installed/);
  assert.deepEqual(await page.evaluate(() => window.__addonManagerCalls), []);
  await section.getByRole('button', { name: 'Install package folder…' }).click();
  await section.getByText('sample.tools', { exact: true }).waitFor();
  assert.match(await section.textContent(), /Restart the editor/);
  await section.getByRole('button', { name: 'Disable' }).click();
  await section.getByRole('button', { name: 'Enable' }).waitFor();
  await section.getByRole('button', { name: 'Enable' }).click();
  await section.getByRole('button', { name: 'Install add-on file…' }).click();
  const editionRow = section.locator('[data-addon-edition]');
  await editionRow.getByText('sample.edition').waitFor();
  assert.match(await section.textContent(), /Installed the edition package sample\.edition 2\.0\.0/);
  assert.match(await editionRow.textContent(), /v2\.0\.0 · Edition package/);
  await editionRow.getByRole('button', { name: 'Remove' }).click();
  await editionRow.waitFor({ state: 'detached' });
  await section.getByRole('button', { name: 'Remove' }).click();
  await section.getByText('No local add-ons installed').waitFor();
  assert.match(await section.textContent(), /Restart the editor/);
  assert.deepEqual(await page.evaluate(() => window.__addonManagerCalls), [
    { name: 'addon_install_folder', args: { source: '/picked/package' } },
    { name: 'addon_package_set_enabled', args: { id: 'sample.tools', enabled: false } },
    { name: 'addon_package_set_enabled', args: { id: 'sample.tools', enabled: true } },
    { name: 'pick-file', args: [{ name: 'Add-on file', extensions: ['ocaddon', 'zip'] }] },
    { name: 'addon_file_install', args: { source: '/picked/sample.ocaddon' } },
    { name: 'addon_edition_remove', args: undefined },
    { name: 'addon_package_remove', args: { id: 'sample.tools' } },
  ]);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Generic local add-on folder and file install, edition package, list, disable, enable and remove UI passed.');
} finally {
  await browser.close();
  await server.close();
  await rm(temp, { recursive: true, force: true });
}
