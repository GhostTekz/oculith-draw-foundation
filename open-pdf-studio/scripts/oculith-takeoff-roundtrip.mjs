import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createServer } from 'vite';
import { constructionReviewFixture } from './oculith-integration-fixture.mjs';

const source = await constructionReviewFixture();
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
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('takeoff-source.pdf');
    await loadPDF('takeoff-source.pdf', index, Uint8Array.from(bytes));
  }, Array.from(source));
  await page.locator('#pdf-container.visible').waitFor({ timeout: 20000 });

  // Draw an uncalibrated dimension through the actual three-click canvas tool.
  const lengthTool = page.locator('.ws-vtoolbar button[data-command="tools.measure.length"]');
  if (await lengthTool.count() && await lengthTool.first().isVisible()) await lengthTool.first().click();
  else {
    await page.locator('.ws-vtoolbar-more').click();
    await page.locator('.ws-menu-label', { hasText: /^Length$/ }).click();
  }
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).state.currentTool === 'measureDistance');
  const sheet = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(sheet && sheet.width > 300);
  for (const [x, y] of [[180, 180], [300, 180], [240, 210]]) {
    await page.mouse.click(sheet.x + x, sheet.y + y);
  }
  await page.keyboard.press('Escape');

  // A numbered scale bar cannot be placed until this drawing has a real
  // document calibration. It must not turn the uncalibrated dimension into
  // a physical quantity or appear in either saved PDF below.
  const scaleBarAttempt = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { scaleBarTool } = await import('/js/tools/tools/scalebar-tool.js');
    const { getMeasureScale } = await import('/js/annotations/measurement.js');
    const { getDialogs, closeDialog } = await import('/js/bridge.ts');
    const doc = getActiveDocument();
    const before = doc.annotations.length;
    scaleBarTool.onPointerDown({ x: 80, y: 80 }, { button: 0 });
    const result = { added: doc.annotations.length - before,
      calibrated: getMeasureScale(1, 80, 80).calibrated,
      calibrationPrompt: getDialogs().some(dialog => dialog.name === 'setScale') };
    closeDialog('setScale');
    return result;
  });
  assert.deepEqual(scaleBarAttempt, { added: 0, calibrated: false, calibrationPrompt: true });

  // Load the rotated CropBox sheet through thumbnails before setting its page scale.
  await page.locator('.ws-host-left .ws-access-tab[data-panel="thumbnails"]').click();
  await page.locator('.thumbnail-item[data-page="4"] img').waitFor();
  await page.locator('.thumbnail-item[data-page="4"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 4);
  await page.evaluate(async () => {
    const { createFullPageScaleRegion, invalidateScaleRegionCache } = await import('/js/annotations/scale-region.js');
    const { openDialog } = await import('/js/bridge.ts');
    const region = createFullPageScaleRegion();
    invalidateScaleRegionCache();
    openDialog('scale-region', { annotationId: region.id, pageNum: region.page, isNew: true });
  });
  await page.locator('.scale-region-dialog').waitFor();
  await page.locator('.scale-region-dialog').getByRole('button', { name: 'Apply' }).click();

  const before = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { createMeasureAreaAnnotation, createMeasurePerimeterAnnotation } = await import('/js/tools/annotation-creators.js');
    const { createScaleRegion, invalidateScaleRegionCache } = await import('/js/annotations/scale-region.js');
    const { calculateDistance, formatMeasurement } = await import('/js/annotations/measurement.js');
    const { createAnnotation } = await import('/js/annotations/factory.js');
    const doc = getActiveDocument();
    doc.currentPage = 1;
    doc.annotations.push(createMeasurePerimeterAnnotation([{ x: 40, y: 40 }, { x: 140, y: 40 }]));
    doc.annotations.push(createMeasureAreaAnnotation([{ x: 40, y: 60 }, { x: 140, y: 60 }, { x: 140, y: 160 }]));
    doc.currentPage = 2;
    const incompleteRegion = createScaleRegion({ page: 2, x: 0, y: 0,
      width: 180, height: 180, units: 'mm' });
    incompleteRegion.scaleString = ''; // imported region with missing scale metadata
    doc.annotations.push(incompleteRegion);
    doc.annotations.push(createAnnotation({ type: 'viewport', page: 2, x: 10, y: 10,
      width: 160, height: 160, name: 'Uncalibrated detail', pixelsPerUnit: null, unit: '', scaleRatio: '' }));
    doc.annotations.push(createAnnotation({ type: 'scaleBar', page: 2, x: 190, y: 20,
      width: 120, height: 14, pixelsPerUnit: null, unit: '', totalUnits: 0 }));
    invalidateScaleRegionCache();
    doc.annotations.push(createMeasurePerimeterAnnotation([{ x: 40, y: 40 }, { x: 140, y: 40 }]));
    doc.currentPage = 4;
    const region = doc.annotations.find(a => a.page === 4 && a.type === 'scaleRegion');
    if (!region) throw new Error('Rotated sheet scale region was not created');
    doc.annotations.push(createMeasurePerimeterAnnotation([{ x: 40, y: 40 }, { x: 140, y: 40 }]));
    doc.annotations.push(createMeasureAreaAnnotation([{ x: 40, y: 60 }, { x: 140, y: 60 }, { x: 140, y: 160 }]));
    doc.annotations.push(createScaleRegion({ page: 4, x: 180, y: 190, width: 120,
      height: 100, scaleString: '1:50', units: 'ft', label: 'Nested detail' }));
    invalidateScaleRegionCache();
    const nested = calculateDistance(190, 210, 270, 210, 4);
    doc.annotations.push(createAnnotation({ type: 'measureDistance', page: 4,
      startX: 190, startY: 210, endX: 270, endY: 210,
      measurePixels: nested.pixels, measureValue: nested.value,
      measureUnit: nested.unit, measureText: formatMeasurement(nested) }));
    if (Math.abs(nested.value - 80 / ((72 / 25.4 / 50) * 304.8)) > 1e-9) {
      throw new Error('Nested region did not select its physical scale');
    }
    return doc.annotations.filter(a => [1, 2, 4].includes(a.page)).map(a => ({
      page: a.page, type: a.type, measureText: a.measureText,
      measureValue: a.measureValue, measureUnit: a.measureUnit,
      scaleString: a.scaleString, units: a.units,
      pixelsPerUnit: a.pixelsPerUnit, unit: a.unit,
    }));
  });
  const find = (items, pageNum, type) => {
    const rows = items.filter(a => a.page === pageNum && a.type === type);
    assert.equal(rows.length, 1, `${pageNum}/${type}: ${JSON.stringify(items)}`);
    return rows[0];
  };
  for (const type of ['measureDistance', 'measurePerimeter', 'measureArea']) {
    const row = find(before, 1, type);
    assert.equal(row.measureUnit, type === 'measureArea' ? 'pt²' : 'pt');
    assert.match(row.measureText, /Scale not set/u);
  }
  for (const type of ['measurePerimeter', 'measureArea']) {
    const row = find(before, 4, type);
    assert.equal(row.measureUnit, type === 'measureArea' ? 'mm²' : 'mm');
    assert.ok(row.measureValue > 0);
    assert.doesNotMatch(row.measureText, /Scale not set/u);
  }
  assert.equal(find(before, 4, 'measureDistance').measureUnit, 'ft');
  assert.doesNotMatch(find(before, 4, 'measureDistance').measureText, /Scale not set/u);
  assert.equal(find(before, 2, 'scaleRegion').scaleString, '');
  for (const type of ['viewport', 'scaleBar']) {
    assert.equal(find(before, 2, type).pixelsPerUnit, null);
    assert.equal(find(before, 2, type).unit, '');
  }
  assert.equal(find(before, 2, 'measurePerimeter').measureUnit, 'pt');
  assert.match(find(before, 2, 'measurePerimeter').measureText, /Scale not set/u);

  async function save(name) {
    const download = page.waitForEvent('download');
    assert.equal(await page.evaluate(async filename => {
      const { savePDF } = await import('/js/pdf/saver.js');
      return savePDF(filename, { zonderHandtekeningVraag: true });
    }, name), true);
    return new Uint8Array(await readFile(await (await download).path()));
  }
  async function inspect(bytes) {
    const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
    const pdf = await task.promise;
    const counts = [1, 2, 4].map(async pageNum => (await (await pdf.getPage(pageNum)).getAnnotations()).length);
    const resolved = await Promise.all(counts);
    await task.destroy();
    // Named viewports are /VP entries, not annotations (one on page 2, two on page 4).
    assert.deepEqual(resolved, [3, 3, 3]);
    const raw = await PDFDocument.load(bytes);
    const ownViewports = (pageIndex) => {
      const vp = raw.getPage(pageIndex).node.lookup(PDFName.of('VP'));
      return (vp ? vp.asArray().map(ref => raw.context.lookup(ref)) : [])
        .filter(dict => dict.get(PDFName.of('OPS_Viewport'))?.asBoolean?.() === true);
    };
    const pageTwo = raw.getPage(1);
    const regions = ownViewports(1);
    assert.equal(regions.length, 1);
    assert.equal(regions[0].get(PDFName.of('OPS_ScaleString')).decodeText(), '');
    assert.equal(regions[0].get(PDFName.of('OPS_Units')).decodeText(), 'mm');
    assert.equal(regions[0].get(PDFName.of('Measure')), undefined,
      'an uncalibrated viewport cannot export a physical scale');
    const uncalibratedSources = pageTwo.node.Annots().asArray()
      .map(ref => raw.context.lookup(ref))
      .filter(dict => ['viewport', 'scaleBar'].includes(dict.get(PDFName.of('OPS_Subtype'))?.decodeText?.()));
    assert.equal(uncalibratedSources.length, 2);
    for (const source of uncalibratedSources) {
      assert.equal(source.get(PDFName.of('OPS_PixelsPerUnit')), undefined,
        'missing source calibration must remain absent in the PDF');
      if (source.get(PDFName.of('OPS_Subtype')).decodeText() === 'scaleBar') {
        assert.equal(source.get(PDFName.of('OPS_TotalUnits')), undefined,
          'a missing physical bar length cannot become a numeric PDF length');
      }
    }
    const nestedRegions = ownViewports(3);
    assert.equal(nestedRegions.length, 2);
    assert.ok(nestedRegions.some(dict => dict.get(PDFName.of('OPS_ScaleString'))?.decodeText?.() === '1:50'
      && dict.get(PDFName.of('OPS_Units'))?.decodeText?.() === 'ft'
      && Math.abs(raw.context.lookup(dict.get(PDFName.of('Measure'))).lookup(PDFName.of('X')).lookup(0)
        .lookup(PDFName.of('C')).asNumber() - 1 / ((72 / 25.4 / 50) * 304.8)) < 1e-9));
  }
  async function reopen(bytes, name) {
    await page.evaluate(async ({ pdfBytes, filename }) => {
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { index } = createTab(filename);
      await loadPDF(filename, index, Uint8Array.from(pdfBytes));
    }, { pdfBytes: Array.from(bytes), filename: name });
    // Playwright treats an async predicate's promise as success and does not
    // poll again. Keep this check synchronous; the module is already loaded.
    await page.evaluate(async () => { window.__ocuState = await import('/js/core/state.ts'); });
    const handle = await page.waitForFunction((filename) => {
      const doc = window.__ocuState.getActiveDocument();
      // The previous tab already has this viewport. Snapshot the reopened
      // file in the same turn the nested viewport is back after color reload.
      const ready = doc?.filePath === filename
        && doc._annotationPagesReady?.size === 4
        && doc._eigenViewportsGelezen === true
        && (doc._pagesNeedingColorUpdate?.size || 0) === 0
        && doc.annotations.some(a => a.page === 4 && a.type === 'scaleRegion' && a.scaleString === '1:50');
      if (!ready) return false;
      return doc.annotations.filter(a => [1, 2, 4].includes(a.page)).map(a => ({
        page: a.page, type: a.type, measureText: a.measureText,
        measureValue: a.measureValue, measureUnit: a.measureUnit,
        scaleString: a.scaleString, units: a.units,
        x: a.x, y: a.y, width: a.width, height: a.height,
        pixelsPerUnit: a.pixelsPerUnit, unit: a.unit,
      }));
    }, name);
    return handle.jsonValue();
  }
  async function checkReopenedRegionScale() {
    const result = await page.evaluate(async () => {
      const { calculateDistance, getMeasureScale } = await import('/js/annotations/measurement.js');
      return {
        inner: calculateDistance(190, 210, 270, 210, 4),
        outer: calculateDistance(40, 40, 140, 40, 4),
        innerScale: getMeasureScale(4, 230, 210),
        outerScale: getMeasureScale(4, 90, 40),
      };
    });
    assert.equal(result.inner.unit, 'ft');
    assert.ok(Math.abs(result.inner.value - 80 / ((72 / 25.4 / 50) * 304.8)) < 1e-9);
    assert.equal(result.innerScale.source, 'scaleRegion');
    assert.equal(result.outer.unit, 'mm');
    assert.ok(Math.abs(result.outer.value - 100 / (72 / 25.4 / 100)) < 1e-9);
    assert.equal(result.outerScale.source, 'scaleRegion');
  }
  const firstBytes = await save('takeoff-first.pdf');
  await inspect(firstBytes);
  const once = await reopen(firstBytes, 'takeoff-first.pdf');
  await checkReopenedRegionScale();
  const innerOnce = once.filter(a => a.page === 4 && a.type === 'scaleRegion' && a.scaleString === '1:50');
  assert.deepEqual(innerOnce.map(a => [a.x, a.y, a.width, a.height, a.units]),
    [[180, 190, 120, 100, 'ft']]);
  for (const type of ['measureDistance', 'measurePerimeter', 'measureArea']) {
    const first = find(before, 1, type), loaded = find(once, 1, type);
    assert.equal(loaded.measureUnit, first.measureUnit);
    assert.ok(Math.abs(loaded.measureValue - first.measureValue) < 0.01);
    assert.match(loaded.measureText, /Scale not set/u);
  }
  for (const type of ['measurePerimeter', 'measureArea']) {
    const first = find(before, 4, type), loaded = find(once, 4, type);
    assert.equal(loaded.measureUnit, first.measureUnit);
    assert.ok(Math.abs(loaded.measureValue - first.measureValue) < 0.01);
  }
  assert.equal(find(once, 4, 'measureDistance').measureUnit, 'ft');
  assert.ok(Math.abs(find(once, 4, 'measureDistance').measureValue
    - find(before, 4, 'measureDistance').measureValue) < 0.01);
  assert.equal(find(once, 2, 'scaleRegion').scaleString, '');
  for (const type of ['viewport', 'scaleBar']) {
    assert.equal(find(once, 2, type).pixelsPerUnit, null);
    assert.equal(find(once, 2, type).unit, '');
  }
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { storeShowProperties } = await import('/js/bridge.ts');
    const { activatePanel } = await import('/js/solid/components/panels/panelActions.js');
    storeShowProperties(getActiveDocument().annotations.find(a => a.page === 2 && a.type === 'viewport'));
    // The oculith profile keeps Properties on the left host, behind Tool Chest.
    activatePanel('properties');
  });
  const viewportProperties = page.locator('#prop-viewport-section');
  await viewportProperties.waitFor();
  assert.equal(await viewportProperties.locator('select').nth(0).inputValue(), '');
  assert.equal(await viewportProperties.locator('select').nth(1).inputValue(), '');
  assert.equal(await viewportProperties.locator('select').nth(1).isDisabled(), true);
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { storeShowProperties } = await import('/js/bridge.ts');
    storeShowProperties(getActiveDocument().annotations.find(a => a.page === 2 && a.type === 'scaleBar'));
  });
  const barProperties = page.locator('#prop-scalebar-section');
  await barProperties.waitFor();
  assert.equal(await barProperties.locator('select').first().inputValue(), '');
  assert.equal(await barProperties.locator('input[type="number"]').first().inputValue(), '');
  assert.equal(await barProperties.locator('input[type="number"]').first().isDisabled(), true);
  const barRendering = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { drawAnnotation } = await import('/js/annotations/rendering.js');
    const bar = getActiveDocument().annotations.find(a => a.page === 2 && a.type === 'scaleBar');
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawAnnotation(ctx, { ...bar, divisions: 4, _ignoreViewFilters: true });
    const pixels = ctx.getImageData(bar.x, bar.y + bar.height + 5, 120, 15).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) colored++;
    }
    const labels = [];
    const nativeFillText = ctx.fillText.bind(ctx);
    ctx.fillText = (value, x, y) => { labels.push(String(value)); nativeFillText(value, x, y); };
    drawAnnotation(ctx, { ...bar, pixelsPerUnit: 2, unit: 'mm', totalUnits: null,
      divisions: 4, _ignoreViewFilters: true });
    return { colored, labels };
  });
  assert.ok(barRendering.colored > 10, 'an even-division uncalibrated bar visibly labels its missing scale');
  assert.ok(barRendering.labels.includes('60'),
    'a calibrated bar without stored total derives its graphic length from width and pixels per unit');
  assert.equal(find(once, 2, 'measurePerimeter').measureUnit, 'pt');
  assert.match(find(once, 2, 'measurePerimeter').measureText, /Scale not set/u);
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { storeShowProperties } = await import('/js/bridge.ts');
    const doc = getActiveDocument();
    storeShowProperties(doc.annotations.find(a => a.page === 2 && a.type === 'scaleRegion'));
  });
  const regionProperties = page.locator('#prop-scaleregion-section');
  await regionProperties.waitFor();
  assert.equal(await regionProperties.locator('select').nth(0).inputValue(), '');
  assert.equal(await regionProperties.locator('select').nth(1).inputValue(), 'mm');
  for (const field of await regionProperties.locator('input[type="number"]').all()) {
    assert.equal(await field.inputValue(), '');
    assert.equal(await field.isDisabled(), true);
  }
  const secondBytes = await save('takeoff-second.pdf');
  await inspect(secondBytes);
  const twice = await reopen(secondBytes, 'takeoff-second.pdf');
  await checkReopenedRegionScale();
  const innerTwice = twice.filter(a => a.page === 4 && a.type === 'scaleRegion' && a.scaleString === '1:50');
  assert.deepEqual(innerTwice.map(a => [a.x, a.y, a.width, a.height, a.units]),
    [[180, 190, 120, 100, 'ft']]);
  for (const type of ['measureDistance', 'measurePerimeter', 'measureArea']) {
    const first = find(before, 1, type), loaded = find(twice, 1, type);
    assert.equal(loaded.measureUnit, first.measureUnit);
    assert.ok(Math.abs(loaded.measureValue - first.measureValue) < 0.01);
    assert.match(loaded.measureText, /Scale not set/u);
  }
  for (const type of ['measurePerimeter', 'measureArea']) {
    const first = find(before, 4, type), loaded = find(twice, 4, type);
    assert.equal(loaded.measureUnit, first.measureUnit);
    assert.ok(Math.abs(loaded.measureValue - first.measureValue) < 0.01);
    assert.doesNotMatch(loaded.measureText, /Scale not set/u);
  }
  assert.equal(find(twice, 4, 'measureDistance').measureUnit, 'ft');
  assert.ok(Math.abs(find(twice, 4, 'measureDistance').measureValue
    - find(before, 4, 'measureDistance').measureValue) < 0.01);
  assert.equal(find(twice, 2, 'scaleRegion').scaleString, '');
  for (const type of ['viewport', 'scaleBar']) {
    assert.equal(find(twice, 2, type).pixelsPerUnit, null);
    assert.equal(find(twice, 2, type).unit, '');
  }
  assert.equal(find(twice, 2, 'measurePerimeter').measureUnit, 'pt');
  assert.match(find(twice, 2, 'measurePerimeter').measureText, /Scale not set/u);
  const exports = await page.evaluate(async () => {
    const doc = (await import('/js/core/state.ts')).getActiveDocument();
    const { markupCsv, markupSummaryRows } = await import('/js/annotations/markup-csv.js');
    const { buildMarkupSummaryPdf } = await import('/js/annotations/markup-pdf.js');
    const font = new Uint8Array(await (await fetch('/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf')).arrayBuffer());
    const selected = doc.annotations.filter(a => a.page === 4 && a.type === 'measureDistance');
    return {
      csv: markupCsv(doc.annotations, selected),
      report: Array.from(await buildMarkupSummaryPdf({ sourcePath: 'takeoff-second.pdf',
        rows: markupSummaryRows(doc.annotations, selected) }, font)),
    };
  });
  // 4.63 ft at the default 1/16" imperial display (measure-precision.js).
  assert.match(exports.csv, /"4'-7 9\/16""","UNVERIFIED"/u);
  const reportTask = getDocument({ data: Uint8Array.from(exports.report), useSystemFonts: false });
  const reportDoc = await reportTask.promise;
  const reportText = (await Promise.all(Array.from({ length: reportDoc.numPages }, async (_, index) =>
    (await (await reportDoc.getPage(index + 1)).getTextContent()).items.map(item => item.str).join(' ')))).join(' ');
  assert.match(reportText, /Measurement shown on markup: 4'-7 9\/16" \| UNVERIFIED/u);
  await reportTask.destroy();
  assert.deepEqual(errors, []);
  console.log('Takeoff roundtrip passed: nested rotated scales, two PDF saves, CSV/PDF measurement summaries');
} finally {
  await browser?.close();
  await server?.close();
}
