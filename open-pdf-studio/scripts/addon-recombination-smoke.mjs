// Browser acceptance for the published add-on host. The first editor load
// receives a neutral fixture through edition_plugin; a fresh load has none.
// In both cases the same PDF must survive a full editor save.
import assert from 'node:assert/strict';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

process.env.OCUDRAW_EDITION = 'community';
const KEY = PDFName.of('OPS_SampleAddonV1');
const temp = await mkdtemp(join(tmpdir(), 'ocudraw-addon-smoke-'));
const tcp = createTcpServer();
await new Promise((resolve, reject) => tcp.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = tcp.address().port;
await new Promise((resolve) => tcp.close(resolve));
const server = await createServer({ cacheDir: join(temp, 'vite-cache'),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });

async function saveFromPage(page) {
  const download = page.waitForEvent('download', { timeout: 60_000 });
  assert.equal(await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF()), true);
  return new Uint8Array(await readFile(await (await download).path()));
}

async function openPdf(page, name, bytes) {
  return page.evaluate(async ({ name, bytes }) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab(name);
    await loadPDF(name, index, Uint8Array.from(bytes));
    return { index, workspace: state.documents[index].sampleAddonWorkspace ?? null };
  }, { name, bytes: Array.from(bytes) });
}

try {
  const source = await PDFDocument.create();
  source.addPage([300, 250]);
  source.catalog.set(KEY, PDFHexString.fromText(JSON.stringify({ stableId: 'fixture', revision: 1 })));
  const sourceBytes = await source.save();
  const url = server.resolvedUrls.local[0];

  const withAddon = await browser.newContext({ acceptDownloads: true });
  await withAddon.addInitScript(() => {
    window.__sampleAddonBrowserSmoke = true;
    window.__TAURI__ = { core: { invoke: async (command) => command === 'edition_plugin'
      ? { url: '/scripts/fixtures/recombination-addon/plugin.js', css: '' }
      : null } };
  });
  const addonPage = await withAddon.newPage();
  const addonErrors = [];
  addonPage.on('pageerror', (error) => addonErrors.push(error.message));
  await addonPage.goto(url, { waitUntil: 'networkidle' });
  await addonPage.waitForFunction(() => globalThis.__ocudrawEdition?.id === 'sample-addon');
  const contract = await addonPage.evaluate(async () => {
    const { edition } = await import('/js/editions/active.js');
    const { getPanelEntry } = await import('/js/solid/components/panels/panelRegistry.js');
    return { id: edition.id, panel: getPanelEntry('sample-addon-panel')?.id,
      dialog: typeof edition.dialogs['sample-addon-dialog'],
      pdfKeys: edition.pdf.catalogKeys, browserFileApi: window.__TAURI__ === undefined };
  });
  assert.deepEqual(contract, { id: 'sample-addon', panel: 'sample-addon-panel', dialog: 'function',
    pdfKeys: ['OPS_SampleAddonV1'], browserFileApi: true });

  await addonPage.evaluate(async () => {
    (await import('/js/solid/components/panels/panelActions.js')).activatePanel('sample-addon-panel');
    (await import('/js/solid/stores/dialogStore.js')).openDialog('sample-addon-dialog');
  });
  await addonPage.locator('[data-sample-addon-panel]').waitFor();
  await addonPage.locator('[data-sample-addon-dialog]').waitFor();
  assert.equal(await addonPage.locator('[data-sample-addon-panel]').textContent(), 'Sample add-on panel');
  assert.equal(await addonPage.locator('[data-sample-addon-dialog]').textContent(), 'Sample add-on dialog');

  const loaded = await openPdf(addonPage, 'sample-addon.pdf', sourceBytes);
  await addonPage.waitForFunction(async (index) => {
    const { state } = await import('/js/core/state.ts');
    return state.documents[index]?.sampleAddonWorkspace?.stableId === 'fixture';
  }, loaded.index);
  assert.deepEqual(await addonPage.evaluate(async (index) => {
    const { state } = await import('/js/core/state.ts');
    return state.documents[index].sampleAddonWorkspace;
  }, loaded.index), { stableId: 'fixture', revision: 1 });
  await addonPage.evaluate(async (index) => {
    const { state } = await import('/js/core/state.ts');
    state.documents[index].sampleAddonWorkspace = { stableId: 'fixture', revision: 2 };
  }, loaded.index);
  const addonSave = await saveFromPage(addonPage);
  const addonPdf = await PDFDocument.load(addonSave.slice());
  assert.deepEqual(JSON.parse(addonPdf.context.lookup(addonPdf.catalog.get(KEY)).decodeText()),
    { stableId: 'fixture', revision: 2 });
  assert.deepEqual(addonErrors, [], `add-on browser errors: ${addonErrors.join('; ')}`);
  await withAddon.close();

  const foundation = await browser.newContext({ acceptDownloads: true });
  const foundationPage = await foundation.newPage();
  const foundationErrors = [];
  foundationPage.on('pageerror', (error) => foundationErrors.push(error.message));
  await foundationPage.goto(url, { waitUntil: 'networkidle' });
  const without = await foundationPage.evaluate(async () => {
    const { edition } = await import('/js/editions/active.js');
    const { getPanelEntry } = await import('/js/solid/components/panels/panelRegistry.js');
    return { id: edition.id, panels: edition.panelIds,
      fixturePanel: getPanelEntry('sample-addon-panel'),
      fixtureDialog: edition.dialogs['sample-addon-dialog'] };
  });
  assert.deepEqual(without, { id: 'foundation', panels: [], fixturePanel: null, fixtureDialog: undefined });
  const foundationLoad = await openPdf(foundationPage, 'foundation-after-addon.pdf', addonSave);
  assert.equal(foundationLoad.workspace, null);
  const foundationSave = await saveFromPage(foundationPage);
  const reopened = await PDFDocument.load(foundationSave.slice());
  assert.deepEqual(JSON.parse(reopened.context.lookup(reopened.catalog.get(KEY)).decodeText()),
    { stableId: 'fixture', revision: 2 });
  assert.deepEqual(foundationErrors, [], `Foundation browser errors: ${foundationErrors.join('; ')}`);
  await foundation.close();
  console.log('Add-on recombination smoke passed: panel, dialog, PDF hook, removal, and opaque PDF preservation.');
} finally {
  await browser.close();
  await server.close();
  await rm(temp, { recursive: true, force: true });
}
