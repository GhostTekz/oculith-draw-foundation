import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const pdf = await PDFDocument.create();
const pages = [pdf.addPage([320, 240]), pdf.addPage([320, 240])];
pages[0].drawText('FIRST PAGE', { x: 30, y: 180 });
pages[1].drawText('SECOND PAGE', { x: 30, y: 180 });
const form = pdf.getForm();
for (const [index, sheet] of pages.entries()) {
  const field = form.createTextField(`review-${index + 1}`);
  field.setText(`Page ${index + 1}`);
  field.addToPage(sheet, { x: 30, y: 90, width: 100, height: 24 });
  const link = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [30, 130, 130, 150],
    A: { S: 'URI', URI: PDFString.of('https://example.com') } });
  sheet.node.lookup(PDFName.of('Annots')).push(link);
}
const bytes = Array.from(await pdf.save());
let server;
let browser;
try {
  const probe = createNetServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  const result = await page.evaluate(async source => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { renderPage } = await import('/js/pdf/renderer.js');
    const { state } = await import('/js/core/state.ts');
    const { index } = createTab('render-race.pdf');
    await loadPDF('render-race.pdf', index, Uint8Array.from(source));
    const doc = state.documents[index];
    const originalGetPage = doc.pdfDoc.getPage.bind(doc.pdfDoc);
    let releaseSlowText;
    let reachedSlowText;
    const atSlowText = new Promise(resolve => { reachedSlowText = resolve; });
    const slowText = new Promise(resolve => { releaseSlowText = resolve; });
    let delayed = false;
    doc.pdfDoc.getPage = async number => {
      const pdfPage = await originalGetPage(number);
      if (number === 1 && !delayed) {
        delayed = true;
        const originalText = pdfPage.getTextContent.bind(pdfPage);
        pdfPage.getTextContent = async (...args) => {
          reachedSlowText();
          await slowText;
          return originalText(...args);
        };
      }
      return pdfPage;
    };
    doc.currentPage = 1;
    document.querySelector('#canvas-container .textLayer')?.remove();
    const older = renderPage(1);
    await atSlowText;
    doc.currentPage = 2;
    await renderPage(2);
    releaseSlowText();
    await older;
    const textLayers = [...document.querySelectorAll('#canvas-container .textLayer')];
    const textResult = { pages: textLayers.map(layer => layer.dataset.page),
      text: textLayers.map(layer => layer.textContent) };

    const firstPage = await originalGetPage(1);
    const originalAnnotations = firstPage.getAnnotations.bind(firstPage);
    async function raceOverlay(delayCall, selector) {
      let release;
      let reached;
      const reachedGate = new Promise(resolve => { reached = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      let calls = 0;
      firstPage.getAnnotations = async (...args) => {
        calls++;
        if (calls === delayCall) { reached(); await gate; }
        return originalAnnotations(...args);
      };
      doc.currentPage = 1;
      const stale = renderPage(1);
      await reachedGate;
      doc.currentPage = 2;
      await renderPage(2);
      release();
      await stale;
      const result = [...document.querySelectorAll(`#canvas-container ${selector}`)]
        .map(layer => layer.dataset.page);
      firstPage.getAnnotations = originalAnnotations;
      return result;
    }
    const linkPages = await raceOverlay(1, '.linkLayer');
    const formPages = await raceOverlay(2, '.formLayer');

    // A destroyed PDF task may reject while its form layer is waiting for
    // document actions. Its catch path must still discard the stale layer.
    const originalActions = doc.pdfDoc.getJSActions.bind(doc.pdfDoc);
    let reachActions;
    let rejectActions;
    const actionsStarted = new Promise(resolve => { reachActions = resolve; });
    const actionsResponse = new Promise((_, reject) => { rejectActions = reject; });
    let heldActions = false;
    doc.pdfDoc.getJSActions = (...args) => {
      if (!heldActions) { heldActions = true; reachActions(); return actionsResponse; }
      return originalActions(...args);
    };
    doc.currentPage = 1;
    const staleActions = renderPage(1);
    await actionsStarted;
    doc.currentPage = 2;
    await renderPage(2);
    rejectActions(new Error('old PDF task closed'));
    await staleActions;
    doc.pdfDoc.getJSActions = originalActions;
    const actionPages = [...document.querySelectorAll('#canvas-container .formLayer')]
      .map(layer => layer.dataset.page);

    // Hold the native text IPC after a vector request has begun, then render
    // another page in the browser. Late Rust text must leave its overlay alone.
    const { createTextLayerFromRust } = await import('/js/text/text-layer.js');
    let reachRust;
    let releaseRust;
    let current = true;
    const rustStarted = new Promise(resolve => { reachRust = resolve; });
    const rustResponse = new Promise(resolve => { releaseRust = resolve; });
    window.__TAURI__ = { core: { invoke: async command => {
      if (command !== 'extract_page_text') throw new Error(`Unexpected native command: ${command}`);
      reachRust();
      return rustResponse;
    } } };
    doc.currentPage = 1;
    const staleRust = createTextLayerFromRust(document.getElementById('canvas-container'),
      1, 320, 240, () => current);
    await rustStarted;
    current = false;
    delete window.__TAURI__;
    doc.currentPage = 2;
    await renderPage(2);
    releaseRust(JSON.stringify([{ text: 'STALE RUST TEXT', x: 20, y: 120, width: 60, fontSize: 12 }]));
    const rustAccepted = await staleRust;
    const rustPages = [...document.querySelectorAll('#canvas-container .textLayer')]
      .map(layer => layer.dataset.page);
    return { textResult, linkPages, formPages, actionPages, rustAccepted, rustPages,
      renders: window.__pdfRenderInFlight };
  }, bytes);
  assert.deepEqual(result.textResult.pages, ['2'], 'older text layer cannot append over the new page');
  assert.match(result.textResult.text[0], /SECOND PAGE/u);
  assert.deepEqual(result.linkPages, ['2'], 'older link layer cannot append over the new page');
  assert.deepEqual(result.formPages, ['2'], 'older form layer cannot append over the new page');
  assert.deepEqual(result.actionPages, ['2'], 'rejected old form actions cannot register a stale layer');
  assert.equal(result.rustAccepted, false, 'late native text cannot be accepted');
  assert.deepEqual(result.rustPages, ['2'], 'late native text cannot replace the newer text layer');
  assert.equal(result.renders, 0);
  assert.deepEqual(errors, []);
  console.log('Render generation passed: delayed PDF.js/native text, link/form overlays and rejected form actions cannot replace the current page');
} finally {
  await browser?.close();
  await server?.close();
}
