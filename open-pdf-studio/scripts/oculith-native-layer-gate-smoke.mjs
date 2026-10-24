// Browser safety gate for K-001: a real PDF's native OCGs appear in the
// Layers panel, but cannot be toggled until every renderer supports selection.
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createServer as createTcpServer } from 'node:net';

const fixture = await PDFDocument.create();
fixture.addPage([100, 100]);
const context = fixture.context;
const visible = context.register(context.obj({ Type: 'OCG', Name: 'Visible grid' }));
const hidden = context.register(context.obj({ Type: 'OCG', Name: 'Hidden utilities' }));
fixture.catalog.set(PDFName.of('OCProperties'), context.obj({
  OCGs: [visible, hidden],
  D: { BaseState: 'ON', OFF: [hidden], Order: [visible, hidden] },
}));
const bytes = Array.from(await fixture.save());

const probe = createTcpServer();
await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = await createServer({ server: { host: '127.0.0.1', port, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async content => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { setActiveTab } = await import('/js/solid/stores/leftPanelStore.js');
    const { updateLayersList } = await import('/js/ui/panels/layers.js');
    const { index } = createTab('native-layers.pdf');
    await loadPDF('native-layers.pdf', index, Uint8Array.from(content));
    setActiveTab('layers');
    await updateLayersList();
  }, bytes);
  const checkboxes = page.locator('#layers-panel .layer-list-item input[type="checkbox"]');
  await checkboxes.first().waitFor({ state: 'attached' });
  assert.equal(await checkboxes.count(), 2);
  assert.deepEqual(await checkboxes.evaluateAll(inputs => inputs.map(input => ({
    checked: input.checked, disabled: input.disabled,
  }))), [
    { checked: true, disabled: true },
    { checked: false, disabled: true },
  ]);
  assert.deepEqual(errors, []);
  console.log('Native layer browser gate passed: PDF OCGs listed, selection remains disabled');
} finally {
  await browser.close();
  await server.close();
}
