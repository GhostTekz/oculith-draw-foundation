// Browser proof: one full edition and two independent contributions start
// together; a colliding middle package leaves no CSS or registry entries.
import assert from 'node:assert/strict';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

process.env.OCUDRAW_EDITION = 'community';
const temp = await mkdtemp(join(tmpdir(), 'draw-multi-addon-'));
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
    window.__TAURI__ = { core: { invoke: async (command) => command === 'edition_plugins' ? [
      { id: 'sample-addon', kind: 'edition', url: '/scripts/fixtures/recombination-addon/plugin.js', css: '' },
      { id: 'sample.first', kind: 'contribution', url: '/scripts/fixtures/multi-addon/first.js', css: '.first-addon { color: red }' },
      { id: 'sample.collision', kind: 'contribution', url: '/scripts/fixtures/multi-addon/collision.js', css: '.colliding-addon { color: red }' },
      { id: 'sample.second', kind: 'contribution', url: '/scripts/fixtures/multi-addon/second.js', css: '.second-addon { color: blue }' },
    ] : null } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.waitForFunction(() => globalThis.__ocudrawEdition?.panelIds.includes('sample-first-panel'));
  const result = await page.evaluate(async () => {
    const { edition } = await import('/js/editions/active.js');
    const { getPanelEntry } = await import('/js/solid/components/panels/panelRegistry.js');
    const { getCommand } = await import('/js/solid/commands/registry.js');
    getCommand('sample.second.command')?.run();
    const { PDFDocument, PDFName, PDFHexString } = globalThis.__ocudrawHost.module('pdf-lib');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 200]);
    const source = { sampleAddonWorkspace: { legacy: true }, sampleSecondState: 'independent catalog' };
    edition.pdf.saveWorkspace(pdf, edition.pdf.workspaceForSave(source, pdf));
    const annot = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 20, 20] });
    edition.pdf.writeAnnotation({ sampleSecondMarkup: 'independent annotation' }, annot,
      { PDFName, pdfTextString: PDFHexString.fromText });
    page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(annot)]));
    const reopened = await PDFDocument.load(await pdf.save());
    const loaded = {};
    edition.pdf.applyWorkspace(loaded, edition.pdf.readWorkspace(reopened));
    const annots = reopened.context.lookup(reopened.getPages()[0].node.get(PDFName.of('Annots')));
    const loadedAnnot = reopened.context.lookup(annots.get(0));
    const annotationValue = loadedAnnot.get(PDFName.of('ODX_sample_2esecond_Markup')).decodeText();
    const decorated = edition.pdf.decorateLoadedAnnotation({}, { extensionFields: {
      ODX_sample_2esecond_Markup: annotationValue,
    } });
    return {
      id: edition.id,
      panels: edition.panelIds,
      firstPanel: getPanelEntry('sample-first-panel')?.id,
      firstDialog: typeof edition.dialogs['sample-first-dialog'],
      commandRan: globalThis.__secondCommandRan === true,
      menu: edition.fileMenuItems,
      toolbar: edition.toolbarItems?.map((item) => item.id),
      styles: [...document.querySelectorAll('style[data-edition-plugin]')].map((style) => style.dataset.editionPlugin),
      pdfRoundTrip: {
        legacy: loaded.sampleAddonWorkspace?.legacy,
        catalog: loaded.sampleSecondState,
        annotation: decorated.sampleSecondMarkup,
      },
    };
  });
  assert.equal(result.id, 'sample-addon');
  assert.deepEqual(result.panels, ['sample-addon-panel', 'sample-first-panel']);
  assert.equal(result.firstPanel, 'sample-first-panel');
  assert.equal(result.firstDialog, 'function');
  assert.equal(result.commandRan, true);
  assert.deepEqual(result.menu, ['sample.second.command']);
  assert.deepEqual(result.toolbar, ['sample-second-button']);
  assert.deepEqual(result.styles, ['sample.first', 'sample.second']);
  assert.deepEqual(result.pdfRoundTrip, { legacy: true,
    catalog: 'independent catalog', annotation: 'independent annotation' });
  assert.deepEqual(errors, []);
  await context.close();
  console.log('Multi add-on smoke passed: legacy base, two contributions, collision isolation, PDF round trip.');
} finally {
  await browser.close();
  await server.close();
  await rm(temp, { recursive: true, force: true });
}
