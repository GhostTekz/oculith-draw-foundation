// Browser-mode Community acceptance: no service network, no account provider,
// and a local PDF survives edit/undo/redo/save/reopen with opaque extension metadata intact.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTcpServer } from 'node:net';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

process.env.OCUDRAW_EDITION = 'community';
const temp = await mkdtemp(join(tmpdir(), 'ocudraw-community-offline-'));
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
  const context = await browser.newContext({ acceptDownloads: true });
  const blocked = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    blocked.push(`${url.protocol}//${url.hostname}`);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  assert.equal(await page.title(), 'Oculith Draw Foundation');
  assert.deepEqual(await page.evaluate(async () => {
    const { edition } = await import('/js/editions/active.js');
    return { accountHook: Object.hasOwn(edition, 'hasAccount'), panels: edition.panelIds,
      commands: edition.fileCommands.length };
  }), { accountHook: false, panels: [], commands: 0 });

  const source = await PDFDocument.create();
  source.addPage([420, 300]);
  const workspace = JSON.stringify({ schema: 'extension-workspace/1', stableId: 'keep-this',
    futureFields: { privateToThisFile: true } });
  source.catalog.set(PDFName.of('OPS_ExtensionWorkspaceV1'), PDFHexString.fromText(workspace));
  const bytes = Array.from(await source.save());

  await page.evaluate(async (data) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const { recordAdd, undo, redo } = await import('/js/core/undo-manager.js');
    const { index } = createTab('community-offline.pdf');
    await loadPDF('community-offline.pdf', index, Uint8Array.from(data));
    const doc = state.documents[index];
    const mark = createAnnotation({ id: 'offline-line', type: 'line', page: 1,
      startX: 40, startY: 70, endX: 180, endY: 90, color: '#1155aa', lineWidth: 2 });
    doc.annotations.push(mark);
    recordAdd(mark);
    await undo();
    if (doc.annotations.some((ann) => ann.id === 'offline-line')) throw new Error('Undo did not remove the line');
    await redo();
    if (!doc.annotations.some((ann) => ann.id === 'offline-line')) throw new Error('Redo did not restore the line');
  }, bytes);

  const download = page.waitForEvent('download', { timeout: 60_000 });
  assert.equal(await page.evaluate(async () =>
    (await import('/js/pdf/saver.js')).savePDF()), true);
  const saved = new Uint8Array(await readFile(await (await download).path()));
  const savedPdf = await PDFDocument.load(saved.slice());
  assert.equal(savedPdf.catalog.lookup(PDFName.of('OPS_ExtensionWorkspaceV1')).decodeText(), workspace);

  const reopened = await page.evaluate(async (data) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab('community-reopened.pdf');
    await loadPDF('community-reopened.pdf', index, Uint8Array.from(data));
    const doc = state.documents[index];
    return { pages: doc.pdfDoc.numPages,
      lines: doc.annotations.filter((ann) => ann.type === 'line').length };
  }, Array.from(saved));
  assert.deepEqual(reopened, { pages: 1, lines: 1 });

  // A PDF saved by an earlier edition can carry a specialized template that
  // Community cannot reproduce. Keep the source intact and refuse a save.
  const older = await PDFDocument.load(saved.slice());
  const pdfContext = older.context;
  const oldSymbol = pdfContext.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [25, 30, 145, 60],
    C: [0, 0, 0], Contents: PDFString.of('Old floor section'),
    OPS_Subtype: PDFString.of('parametricSymbol'),
    OPS_SymbolId: PDFHexString.fromText('vloer-kanaalplaatvloer'),
    OPS_Params: PDFHexString.fromText(JSON.stringify({ maat: '200 standaard' })),
  });
  const appearance = pdfContext.stream('q 0 0 0 RG 2 w 0 0 m 120 30 l S Q',
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 120, 30] });
  oldSymbol.set(PDFName.of('AP'), pdfContext.obj({ N: pdfContext.register(appearance) }));
  older.getPage(0).node.addAnnot(pdfContext.register(oldSymbol));
  const oldBytes = Array.from(await older.save());
  const blockedSave = await page.evaluate(async (data) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab('older-floor.pdf');
    await loadPDF('older-floor.pdf', index, Uint8Array.from(data));
    const doc = state.documents[index];
    const symbol = doc.annotations.find((ann) => ann.symbolId === 'vloer-kanaalplaatvloer');
    if (!symbol) throw new Error('The older floor symbol was not loaded');
    const saved = await (await import('/js/pdf/saver.js')).savePDF();
    return { saved, symbolId: symbol.symbolId, params: symbol.params };
  }, oldBytes);
  assert.equal(blockedSave.saved, false);
  assert.equal(blockedSave.symbolId, 'vloer-kanaalplaatvloer');
  assert.equal(blockedSave.params.maat, '200 standaard');
  assert.deepEqual(blocked, [], `Community requested an external origin: ${blocked.join(', ')}`);
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('Foundation offline smoke passed: edit/undo/redo/save/reopen, opaque metadata and safe older-symbol refusal.');
} finally {
  await browser.close();
  await server.close();
  await rm(temp, { recursive: true, force: true });
}
