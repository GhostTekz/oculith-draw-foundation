import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { createServer } from 'vite';

// The inner viewport is drawn in PDF user space. Its app-space bounds on the
// rotated CropBox page are x=160..310, y=114..264.
async function sourcePdf() {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([612, 792]);
  sheet.setCropBox(36, 40, 504, 680);
  sheet.setRotation(degrees(90));
  const vp = (bbox, unit, pointsPerUnit, name) => ({
    Type: 'Viewport', BBox: bbox, Name: PDFString.of(name),
    Measure: { Type: 'Measure', Subtype: 'RL',
      X: [{ U: PDFString.of(unit), C: 1 / pointsPerUnit, D: 1 }] },
  });
  sheet.node.set(PDFName.of('VP'), pdf.context.obj([
    vp([36, 40, 540, 720], 'ft', 20, 'Overall'),
    vp([150, 200, 300, 350], 'm', 50, 'Detail'),
  ]));
  const barSheet = pdf.addPage([612, 792]);
  barSheet.setCropBox(36, 40, 504, 680);
  barSheet.setRotation(degrees(90));
  return new Uint8Array(await pdf.save());
}

const source = await sourcePdf();
const probe = createNetServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
let server;
let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: { port } }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });

  async function open(bytes, filename) {
    await page.evaluate(async ({ data, name }) => {
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(data));
    }, { data: Array.from(bytes), name: filename });
    await page.waitForFunction(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const doc = getActiveDocument();
      return doc?.pdfViewports?.[1]?.length === 2 && doc?._annotationPagesReady?.size === 2;
    });
  }
  await open(source, 'calibrated-source.pdf');

  const values = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { calculateDistance, getMeasureScale } = await import('/js/annotations/measurement.js');
    const { createScaleBar } = await import('/js/annotations/scale-bar.js');
    const { createMeasurePerimeterAnnotation } = await import('/js/tools/annotation-creators.js');
    const doc = getActiveDocument();
    const outer = calculateDistance(40, 50, 140, 50, 1);
    const inner = calculateDistance(180, 150, 280, 150, 1);
    doc.currentPage = 1;
    doc.annotations.push(createMeasurePerimeterAnnotation([{ x: 180, y: 150 }, { x: 280, y: 150 }]));
    doc.currentPage = 2;
    doc.measureScale = { pixelsPerUnit: 0.2, unit: 'cm', method: 'quick-scale' };
    doc.annotations.push(createScaleBar(30, 30));
    doc.annotations.push(createMeasurePerimeterAnnotation([{ x: 30, y: 80 }, { x: 130, y: 80 }]));
    return { outer, inner, remoteBarCannotMaskViewport: getMeasureScale(1, 200, 150),
      bar: getMeasureScale(2, 80, 80),
      barAnnotation: doc.annotations.find(a => a.type === 'scaleBar'),
      marks: doc.annotations.filter(a => a.type === 'measurePerimeter').map(a => ({
        page: a.page, unit: a.measureUnit, value: a.measureValue, text: a.measureText,
      })) };
  });
  assert.equal(values.outer.unit, 'ft');
  assert.ok(Math.abs(values.outer.value - 5) < 0.001);
  assert.equal(values.inner.unit, 'm');
  assert.ok(Math.abs(values.inner.value - 2) < 0.001);
  assert.equal(values.remoteBarCannotMaskViewport.method, 'pdfViewport');
  assert.equal(values.bar.method, 'scaleBar');
  assert.equal(values.barAnnotation.totalUnits, 500, 'five metres is 500 cm');
  assert.equal(values.barAnnotation.width, 100, 'bar width follows the source calibration');
  assert.deepEqual(values.marks.map(m => [m.page, m.unit, m.value]), [[1, 'm', 2], [2, 'cm', 500]]);
  assert.ok(values.marks.every(m => !m.text.includes('Scale not set')));

  const drawnBar = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { drawAnnotation } = await import('/js/annotations/rendering.js');
    const bar = getActiveDocument().annotations.find(a => a.type === 'scaleBar');
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const labels = [];
    const fillText = ctx.fillText.bind(ctx);
    ctx.fillText = (label, x, y) => { labels.push(String(label)); fillText(label, x, y); };
    drawAnnotation(ctx, { ...bar, _ignoreViewFilters: true });
    const pixels = ctx.getImageData(30, 30, 100, 40).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) ink++;
    }
    return { labels, ink };
  });
  assert.ok(drawnBar.ink > 50, 'the scale bar draws visible canvas pixels');
  assert.ok(drawnBar.labels.includes('5'), 'the bar labels its five-metre endpoint');
  assert.ok(drawnBar.labels.includes('m'), 'the bar displays metres for a 500 cm length');
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { storeShowProperties } = await import('/js/bridge.ts');
    const { activatePanel } = await import('/js/solid/components/panels/panelActions.js');
    storeShowProperties(getActiveDocument().annotations.find(a => a.type === 'scaleBar'));
    // The oculith profile keeps Properties on the left host, behind Tool Chest.
    activatePanel('properties');
  });
  const barProperties = page.locator('#prop-scalebar-section');
  await barProperties.waitFor();
  assert.equal(await barProperties.locator('select').first().inputValue(), 'cm');
  assert.equal(await barProperties.locator('input[type="number"]').first().inputValue(), '500');

  async function save(name) {
    const download = page.waitForEvent('download');
    assert.equal(await page.evaluate(async filename => {
      const { savePDF } = await import('/js/pdf/saver.js');
      return savePDF(filename, { zonderHandtekeningVraag: true });
    }, name), true);
    return new Uint8Array(await readFile(await (await download).path()));
  }
  async function inspect(bytes) {
    const pdf = await PDFDocument.load(bytes);
    const vps = pdf.getPage(0).node.lookup(PDFName.of('VP'));
    assert.equal(vps.size(), 2, 'saved bytes keep both imported PDF viewports');
    const bar = pdf.getPage(1).node.Annots().asArray()
      .map(ref => pdf.context.lookup(ref))
      .find(dict => dict.get(PDFName.of('OPS_Subtype'))?.decodeText?.() === 'scaleBar');
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 504, height: 680 });
    assert.equal(bar.get(PDFName.of('OPS_PixelsPerUnit')).asNumber(), 0.2);
    assert.equal(bar.get(PDFName.of('OPS_Unit')).decodeText(), 'cm');
    assert.equal(bar.get(PDFName.of('OPS_TotalUnits')).asNumber(), 500);
  }
  async function checkReopened(bytes, name) {
    await open(bytes, name);
    const result = await page.evaluate(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const { calculateDistance, getMeasureScale } = await import('/js/annotations/measurement.js');
      const doc = getActiveDocument();
      return { inner: calculateDistance(180, 150, 280, 150, 1),
        outer: calculateDistance(40, 50, 140, 50, 1),
        bar: getMeasureScale(2, 80, 80),
        barAnnotation: doc.annotations.find(a => a.type === 'scaleBar'),
        marks: doc.annotations.filter(a => a.type === 'measurePerimeter').map(a => ({
          page: a.page, unit: a.measureUnit, value: a.measureValue, text: a.measureText,
        })) };
    });
    assert.equal(result.inner.unit, 'm');
    assert.ok(Math.abs(result.inner.value - 2) < 0.001);
    assert.equal(result.outer.unit, 'ft');
    assert.equal(result.bar.unit, 'cm');
    assert.equal(result.bar.pixelsPerUnit, 0.2);
    assert.equal(result.barAnnotation.totalUnits, 500);
    assert.equal(result.barAnnotation.x, 30);
    assert.equal(result.barAnnotation.y, 30);
    assert.equal(result.barAnnotation.width, 100);
    assert.deepEqual(result.marks.map(m => [m.page, m.unit, m.value]), [[1, 'm', 2], [2, 'cm', 500]]);
  }
  const first = await save('calibrated-first.pdf');
  await inspect(first);
  await checkReopened(first, 'calibrated-first.pdf');
  const second = await save('calibrated-second.pdf');
  await inspect(second);
  await checkReopened(second, 'calibrated-second.pdf');
  assert.deepEqual(errors, []);
  console.log('Calibrated takeoff passed: rotated CropBox /VP overlap, five-metre centimetre bar, two PDF saves');
} finally {
  await browser?.close();
  await server?.close();
}
