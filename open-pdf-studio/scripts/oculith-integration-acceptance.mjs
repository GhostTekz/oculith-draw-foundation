import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createServer } from 'vite';
import { constructionReviewFixture } from './oculith-integration-fixture.mjs';

async function pdfMarkupSignatures(bytes, pageNumber) {
  const pdf = await PDFDocument.load(bytes.slice());
  const page = pdf.getPage(pageNumber - 1);
  const read = (dict, key) => dict.get(PDFName.of(key))?.decodeText?.() || '';
  return (page.node.Annots()?.asArray() || []).map(ref => {
    const dict = pdf.context.lookup(ref);
    return [dict.get(PDFName.of('Subtype'))?.toString().slice(1) || '',
      read(dict, 'OPS_Subtype'), read(dict, 'OPS_SymbolId'), read(dict, 'Contents')].join('|');
  }).sort();
}

const expectedPage2PdfMarkups = [
  'Line|measureDistance||2822',
  'Square|count||',
  'Stamp||oculith-receptacle|',
  'Text|||Reviewed',
  'Text|||Verify lighting panel clearance on A-102',
].sort();
const expectedPage4PdfMarkups = ['Square|count||'];

// Named viewports are /VP entries on the page, not annotations.
async function ownViewportCount(bytes, pageNumber) {
  const pdf = await PDFDocument.load(bytes.slice());
  const vp = pdf.getPage(pageNumber - 1).node.lookup(PDFName.of('VP'));
  if (!vp) return 0;
  return vp.asArray().map(ref => pdf.context.lookup(ref))
    .filter(dict => dict.get(PDFName.of('OPS_Viewport'))?.asBoolean?.() === true).length;
}

const directory = await mkdtemp(join(tmpdir(), 'ocudraw-integration-'));
const issuedPath = join(directory, 'issued-four-sheets.pdf');
const issued = await constructionReviewFixture();
const revised = await constructionReviewFixture({ revised: true });
await writeFile(issuedPath, issued);
let server;
let browser;
try {
  const probe = createNetServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  server = await createServer({
    cacheDir: join(directory, 'vite-cache'),
    server: { host: '127.0.0.1', port, strictPort: true, hmr: { port } },
    logLevel: 'error',
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('browser console:', message.text()); });
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(() => import('/js/pdf/loader.js').then(() => true));
  async function useCanvasTool(command, label) {
    const toolName = command.endsWith('.count') ? 'count'
      : command.endsWith('.length') ? 'measureDistance'
      : command.endsWith('.note') ? 'comment'
      : '';
    const button = page.locator(`.ws-vtoolbar button[data-command="${command}"]`);
    if (await button.count() && await button.first().isVisible()) {
      await button.first().click();
    } else {
      await page.locator('.ws-vtoolbar-more').click();
      await page.locator('.ws-menu-label', { hasText: new RegExp(`^${label}$`) }).click();
    }
    if (toolName) {
      await page.waitForFunction(async (name) => (await import('/js/core/state.ts')).state.currentTool === name, toolName);
    }
  }

  // Open through the actual file chooser and navigate by a rendered thumbnail.
  const chooser = page.waitForEvent('filechooser', { timeout: 60000 });
  await page.locator('.draw-open-button').click();
  await (await chooser).setFiles(issuedPath);
  await page.locator('#pdf-container.visible').waitFor({ timeout: 20000 });
  await page.locator('.ws-host-left .ws-access-tab[data-panel="thumbnails"]').click();
  await page.locator('.thumbnail-item[data-page="2"] img').waitFor({ timeout: 20000 });
  await page.locator('.thumbnail-item[data-page="2"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 2);
  assert.match(await page.locator('#nav-page-input').inputValue(), /(^|\()2 of \d+\)?$/);
  const sheet = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(sheet && sheet.width > 300 && sheet.height > 300);
  const at = (dx, dy) => ({ x: sheet.x + dx, y: sheet.y + dy });

  // Thumbnails and the Tool Chest share the left host, so the receptacle
  // tile is only visible after the Tool Chest tab is active again.
  await page.locator('.ws-host-left .ws-access-tab[data-panel="toolChest"]').click();
  await page.locator('.ws-panel-slot[data-panel="toolChest"].active .sp-symbol-btn.sp-symbol-oculith').first().click();
  await page.mouse.click(at(180, 190).x, at(180, 190).y);
  await page.keyboard.press('Escape');
  await useCanvasTool('tools.measure.count', 'Count');
  await page.mouse.click(at(290, 280).x, at(290, 280).y);
  await page.keyboard.press('Escape');

  // A full sheet viewport makes the explicit scale part of the saved PDF.
  await page.evaluate(async () => {
    const { createFullPageScaleRegion, invalidateScaleRegionCache } = await import('/js/annotations/scale-region.js');
    const { openDialog } = await import('/js/bridge.ts');
    const region = createFullPageScaleRegion();
    invalidateScaleRegionCache();
    openDialog('scale-region', { annotationId: region.id, pageNum: region.page, isNew: true });
  });
  await page.locator('.scale-region-dialog').waitFor();
  await page.locator('.scale-region-dialog').getByRole('button', { name: 'Apply' }).click();
  await useCanvasTool('tools.measure.length', 'Length');
  // Distance is a three-click drafting tool: endpoints, then label side.
  for (const point of [at(220, 360), at(340, 360), at(280, 390)]) {
    await page.mouse.click(point.x, point.y);
  }
  await page.keyboard.press('Escape');
  await useCanvasTool('tools.markup.note', 'Note');
  await page.mouse.click(at(420, 210).x, at(420, 210).y);
  await page.locator('.sticky-popup-textarea').fill('Verify lighting panel clearance on A-102');
  await page.locator('.sticky-popup-close').click();

  const before = await page.evaluate(async () => {
    const { getActiveDocument, state } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    return { tool: state.currentTool, page: doc.currentPage, annotations: doc.annotations.filter(a => a.page === 2).map(a => ({
      id: a.id, type: a.type, symbolId: a.symbolId, category: a.category,
      measureText: a.measureText, measureUnit: a.measureUnit, scaleString: a.scaleString, units: a.units,
    })) };
  });
  await page.screenshot({ path: join(directory, 'before-review.png') });
  assert.ok(before.annotations.some(a => a.type === 'stamp' && a.symbolId?.startsWith('oculith-')), JSON.stringify(before));
  assert.ok(before.annotations.some(a => a.type === 'count'), JSON.stringify(before));
  assert.ok(before.annotations.some(a => a.type === 'scaleRegion' && a.scaleString === '1:100'), JSON.stringify(before));
  assert.ok(before.annotations.some(a => a.type === 'measureDistance' && a.measureUnit === 'mm' && Number(a.measureText) > 0), JSON.stringify(before));

  // The Markups List is the selection path for review metadata.
  await page.locator('.markups-dock.open').waitFor();
  const noteRow = page.locator('.markups-dock .annotation-list-item').filter({ hasText: 'Verify lighting panel clearance on A-102' });
  await noteRow.click();
  await page.locator('.ws-host-left .ws-access-tab[data-panel="properties"]').click();
  await page.locator('#prop-general-section select').filter({ has: page.locator('option[value="reviewed"]') }).selectOption('reviewed');
  await page.waitForFunction(() => document.querySelector('.markups-dock')?.textContent?.includes('Reviewed'));
  await page.screenshot({ path: join(directory, 'review-workspace.png') });

  // M-301 has /Rotate 90 and a nonzero CropBox. Place a count on its rendered
  // canvas so save/reopen also tests a transformed sheet in the same drawing.
  await page.locator('.ws-host-left .ws-access-tab[data-panel="thumbnails"]').click();
  await page.locator('.thumbnail-item[data-page="4"] img').waitFor();
  await page.locator('.thumbnail-item[data-page="4"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 4);
  await page.waitForFunction(() => {
    const box = document.getElementById('pdf-canvas')?.getBoundingClientRect();
    return !!box && box.width > box.height && box.height > 300;
  });
  const rotatedSheet = await page.locator('#pdf-canvas').boundingBox();
  assert.ok(rotatedSheet && rotatedSheet.width > rotatedSheet.height && rotatedSheet.height > 300);
  await useCanvasTool('tools.measure.count', 'Count');
  await page.mouse.click(rotatedSheet.x + rotatedSheet.width / 2, rotatedSheet.y + rotatedSheet.height / 2);
  await page.keyboard.press('Escape');
  const rotatedCount = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(a => a.page === 4 && a.type === 'count'));
  assert.equal(rotatedCount.length, 1);
  await page.locator('.thumbnail-item[data-page="2"]').click();
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?.currentPage === 2);

  // Browser save emits the actual PDF bytes through the app's web fallback.
  const savedDownload = page.waitForEvent('download');
  const saved = await page.evaluate(async () => {
    const { savePDF } = await import('/js/pdf/saver.js');
    return savePDF('reviewed-four-sheets.pdf', { zonderHandtekeningVraag: true });
  });
  assert.equal(saved, true);
  const savedBytes = new Uint8Array(await readFile(await (await savedDownload).path()));
  await writeFile(join(directory, 'reviewed-four-sheets.pdf'), savedBytes);
  assert.ok(savedBytes.length > issued.length);
  const task = getDocument({ data: savedBytes.slice(), useSystemFonts: false });
  const independent = await task.promise;
  assert.equal(independent.numPages, 4);
  const pdfAnnotations = await (await independent.getPage(2)).getAnnotations();
  assert.equal(pdfAnnotations.length, 5, JSON.stringify(pdfAnnotations.map(a => a.subtype)));
  assert.deepEqual(await pdfMarkupSignatures(savedBytes, 2), expectedPage2PdfMarkups);
  assert.equal(await ownViewportCount(savedBytes, 2), 1);
  assert.deepEqual(await pdfMarkupSignatures(savedBytes, 4), expectedPage4PdfMarkups);
  const page4Pdf = await independent.getPage(4);
  assert.deepEqual(page4Pdf.view, [36, 40, 576, 760]);
  assert.equal(page4Pdf.rotate, 90);
  const rotatedPdfAnnotations = await page4Pdf.getAnnotations();
  assert.equal(rotatedPdfAnnotations.length, 1);
  const firstViewport = page4Pdf.getViewport({ scale: 1 });
  const firstRect = rotatedPdfAnnotations[0].rect;
  const firstCenter = firstViewport.convertToViewportPoint((firstRect[0] + firstRect[2]) / 2,
    (firstRect[1] + firstRect[3]) / 2);
  assert.ok(Math.abs(firstCenter[0] - rotatedCount[0].x) < 1 &&
    Math.abs(firstCenter[1] - rotatedCount[0].y) < 1,
  `rotated count PDF position: ${firstCenter}, model: ${rotatedCount[0].x},${rotatedCount[0].y}`);
  await task.destroy();

  // Reopen the saved bytes through the loader, then export the real list.
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('reviewed-four-sheets.pdf');
    await loadPDF('reviewed-four-sheets.pdf', index, Uint8Array.from(bytes));
  }, Array.from(savedBytes));
  await page.waitForFunction(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const doc = getActiveDocument();
    return doc?._annotationPagesReady?.size === 4 && doc._pagesNeedingColorUpdate?.size === 0
      && doc.annotations.some(a => a.page === 2 && a.type === 'stamp' && a.symbolId);
  });
  const after = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(a => a.page === 2).map(a => ({ type: a.type, symbolId: a.symbolId, status: a.status, text: a.text, measureText: a.measureText, measureUnit: a.measureUnit })));
  assert.ok(after.some(a => a.type === 'stamp' && a.symbolId?.startsWith('oculith-')), JSON.stringify(after));
  assert.ok(after.some(a => a.type === 'comment' && a.status === 'reviewed' && /lighting panel/.test(a.text)), JSON.stringify(after));
  assert.ok(after.some(a => a.type === 'count'), JSON.stringify(after));
  assert.ok(after.some(a => a.type === 'measureDistance' && a.measureUnit === 'mm' && Number(a.measureText) > 0), JSON.stringify(after));
  const reopenedRotatedCount = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument()
    .annotations.filter(a => a.page === 4 && a.type === 'count'));
  assert.equal(reopenedRotatedCount.length, 1);
  for (const key of ['x', 'y']) {
    assert.ok(Math.abs(reopenedRotatedCount[0][key] - rotatedCount[0][key]) < 1,
      `rotated count ${key}: ${rotatedCount[0][key]} → ${reopenedRotatedCount[0][key]}`);
  }
  // The bottom host is already the open Markups List. Clicking that access
  // tab again collapses the host, which hides the export menu.
  await page.locator('.markups-dock.open').waitFor();
  await page.locator('.markups-dock.open #annotations-panel .ml-more .annotations-toolbar-btn').click();
  const csvDownload = page.waitForEvent('download');
  await page.getByText('Export Comments to Data File... (CSV)').click();
  const csv = await readFile(await (await csvDownload).path(), 'utf8');
  assert.match(csv, /Verify lighting panel clearance/);
  assert.match(csv, /reviewed/i);

  // Save the reopened document again. Check real PDF bytes as well as the app
  // model: duplicating the original /Annots while adding the loaded models
  // would otherwise make the sheet look correct in the app until export.
  const secondDownload = page.waitForEvent('download');
  assert.equal(await page.evaluate(async () => {
    const { savePDF } = await import('/js/pdf/saver.js');
    return savePDF('reviewed-twice.pdf', { zonderHandtekeningVraag: true });
  }), true);
  const secondBytes = new Uint8Array(await readFile(await (await secondDownload).path()));
  await writeFile(join(directory, 'reviewed-twice.pdf'), secondBytes);
  const secondTask = getDocument({ data: secondBytes.slice(), useSystemFonts: false });
  const secondReader = await secondTask.promise;
  assert.equal(secondReader.numPages, 4);
  const secondPage2 = await (await secondReader.getPage(2)).getAnnotations();
  const secondPage4Pdf = await secondReader.getPage(4);
  const secondPage4 = await secondPage4Pdf.getAnnotations();
  assert.deepEqual(secondPage2.map(a => a.subtype).sort(), pdfAnnotations.map(a => a.subtype).sort());
  assert.equal(secondPage2.length, 5, 'page-2 PDF annotations doubled on second save');
  assert.equal(await ownViewportCount(secondBytes, 2), 1, 'page-2 viewport doubled on second save');
  assert.equal(secondPage4.length, 1, 'rotated page count doubled on second save');
  assert.deepEqual(await pdfMarkupSignatures(secondBytes, 2), expectedPage2PdfMarkups);
  assert.deepEqual(await pdfMarkupSignatures(secondBytes, 4), expectedPage4PdfMarkups);
  const secondRect = secondPage4[0].rect;
  const secondCenter = secondPage4Pdf.getViewport({ scale: 1 }).convertToViewportPoint(
    (secondRect[0] + secondRect[2]) / 2, (secondRect[1] + secondRect[3]) / 2);
  assert.ok(Math.abs(secondCenter[0] - rotatedCount[0].x) < 1 &&
    Math.abs(secondCenter[1] - rotatedCount[0].y) < 1,
  `second-save rotated count PDF position: ${secondCenter}, model: ${rotatedCount[0].x},${rotatedCount[0].y}`);
  await secondTask.destroy();
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { cacheWebFile } = await import('/js/core/platform.js');
    cacheWebFile('reviewed-twice.pdf', Uint8Array.from(bytes));
    const { index } = createTab('reviewed-twice.pdf');
    await loadPDF('reviewed-twice.pdf', index, Uint8Array.from(bytes));
  }, Array.from(secondBytes));
  await page.waitForFunction(async () => (await import('/js/core/state.ts')).getActiveDocument()?._annotationPagesReady?.size === 4);
  const twice = await page.evaluate(async () => (await import('/js/core/state.ts')).getActiveDocument().annotations
    .map(a => ({ page: a.page, type: a.type, symbolId: a.symbolId, text: a.text,
      status: a.status, measureUnit: a.measureUnit, measureValue: a.measureValue })));
  const one = (predicate, label) => assert.equal(twice.filter(predicate).length, 1, `${label}: ${JSON.stringify(twice)}`);
  one(a => a.page === 2 && a.type === 'stamp' && a.symbolId?.startsWith('oculith-'), 'Oculith symbol');
  one(a => a.page === 2 && a.type === 'count', 'page-2 count');
  one(a => a.page === 2 && a.type === 'comment' && a.status === 'reviewed' && /lighting panel/.test(a.text), 'Reviewed note');
  one(a => a.page === 2 && a.type === 'measureDistance' && a.measureUnit === 'mm' && a.measureValue > 0, 'measured length');
  one(a => a.page === 4 && a.type === 'count', 'rotated page count');

  // Compare clean source bytes with revision B so rendered markup differences
  // do not swallow the local blue panel region. Also check that comparing the
  // saved review copy would report the removed count as a structural change.
  const reviewDifferences = await page.evaluate(async ({ issuedBytes, revisedBytes }) => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { cacheWebFile } = await import('/js/core/platform.js');
    cacheWebFile('issued-reference.pdf', Uint8Array.from(issuedBytes));
    let index = createTab('issued-reference.pdf').index;
    await loadPDF('issued-reference.pdf', index, Uint8Array.from(issuedBytes));
    cacheWebFile('revision-b.pdf', Uint8Array.from(revisedBytes));
    index = createTab('revision-b.pdf').index;
    await loadPDF('revision-b.pdf', index, Uint8Array.from(revisedBytes));
    const { state } = await import('/js/core/state.ts');
    const compare = await import('/js/compare/compare-store.js');
    const { diffAnnotationsForPair } = await import('/js/compare/compare-annotations.js');
    const reviewChanges = diffAnnotationsForPair('reviewed-twice.pdf', 2, 'revision-b.pdf', 2);
    compare.startCompare({ oldFilePath: 'issued-reference.pdf', newFilePath: 'revision-b.pdf', oldPage: 2, newPage: 2, mode: 'side' });
    compare.confirmCurrentPagePair();
    return reviewChanges.map(change => ({ type: change.type, annType: change.annType }));
  }, { issuedBytes: Array.from(issued), revisedBytes: Array.from(revised) });
  assert.ok(reviewDifferences.some(change => change.type === 'removed' && change.annType === 'count'),
    'count markers from the saved review copy must be comparable');
  await page.locator('#compare-old-page').fill('1');
  await page.locator('#compare-new-page').fill('1');
  await page.getByRole('button', { name: 'Show pair' }).click();
  await page.locator('#compare-old-page').fill('2');
  await page.locator('#compare-new-page').fill('2');
  await page.getByRole('button', { name: 'Show pair' }).click();
  // The compare view first renders both pages, then debounces the pixel pass.
  await page.waitForTimeout(2500);
  await page.waitForFunction(async () => {
    const compare = await import('/js/compare/compare-store.js');
    if (compare.compareDetecting() || !compare.compareChanges().length) {
      window.__integrationCompareStableSince = 0;
      return false;
    }
    window.__integrationCompareStableSince ||= Date.now();
    return Date.now() - window.__integrationCompareStableSince > 1500;
  }, null, { timeout: 45000 });
  await page.screenshot({ path: join(directory, 'compare-workspace.png') });
  const comparison = await page.evaluate(async () => {
    const compare = await import('/js/compare/compare-store.js');
    const { diffAnnotationsForPair } = await import('/js/compare/compare-annotations.js');
    return {
      oldPath: compare.compareOldPath(), newPath: compare.compareNewPath(),
      oldPage: compare.compareOldPage(), newPage: compare.compareNewPage(),
      pairing: compare.compareCurrentConfirmedPair(), offset: compare.compareOffset(),
      visual: compare.compareChanges(),
      annotation: diffAnnotationsForPair(compare.compareOldPath(), compare.compareOldPage(),
        compare.compareNewPath(), compare.compareNewPage()),
    };
  });
  const changes = comparison.visual.length;
  assert.equal(changes, 2, 'the revision label and blue panel are separate visual changes');
  const visualPageBounds = comparison.visual.map(change => ({
    type: change.type,
    x: change.x / change.detectScale, y: change.y / change.detectScale,
    width: change.width / change.detectScale, height: change.height / change.detectScale,
  })).sort((a, b) => a.y - b.y);
  for (const [index, expected] of [
    { x: 188, y: 63, width: 7, height: 7 },
    { x: 262, y: 344, width: 80, height: 56 },
  ].entries()) {
    const actual = visualPageBounds[index];
    assert.equal(actual.type, 'modified', `revision region ${index + 1} type`);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(actual[key] - expected[key]) < 4,
        `revision region ${index + 1} ${key}: expected near ${expected[key]}, got ${actual[key]}`);
    }
  }
  assert.equal(comparison.oldPage, 2);
  assert.equal(comparison.newPage, 2);
  assert.equal(comparison.pairing?.source, 'manual');
  assert.equal(comparison.annotation.length, 0, 'clean issued and revised PDFs have no markups');
  const allReported = [...comparison.visual, ...comparison.annotation];
  const reportedChanges = allReported.length;
  assert.equal(reportedChanges, 2, 'the clean source PDFs add no structural markup changes');

  // Export the live confirmed pair, then read the PDF report as an independent
  // reader would. Its count includes visual and structural annotation changes.
  const reportDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Export change PDF' }).click();
  const reportBytes = new Uint8Array(await readFile(await (await reportDownload).path()));
  await writeFile(join(directory, 'a102-change-report.pdf'), reportBytes);
  const reportTask = getDocument({ data: reportBytes.slice(), useSystemFonts: false });
  const reportReader = await reportTask.promise;
  const reportPages = await Promise.all(Array.from({ length: reportReader.numPages }, (_, i) => reportReader.getPage(i + 1)));
  const reportText = (await Promise.all(reportPages.map(async pdfPage =>
    (await pdfPage.getTextContent()).items.map(item => item.str).join(' ')))).join(' ');
  assert.match(reportText, /COMPARISON CHANGE REPORT/);
  assert.match(reportText, /issued-reference\.pdf/);
  assert.match(reportText, /revision-b\.pdf/);
  assert.match(reportText, /Old source - page 2/);
  assert.match(reportText, /New source - page 2/);
  assert.match(reportText, /Page pairing: confirmed manually/);
  assert.match(reportText, /Detected changes: 2\b/);
  assert.match(reportText, /Change 1 - MODIFIED \(visual\)/);
  assert.match(reportText, /Change 2 - MODIFIED \(visual\)/);
  assert.match(reportText, /UNREVIEWED/);
  await reportTask.destroy();

  const changeCsvDownload = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Export change CSV' }).click();
  const changeCsv = await readFile(await (await changeCsvDownload).path(), 'utf8');
  await writeFile(join(directory, 'a102-change-report.csv'), changeCsv);
  const reportRows = changeCsv.replace(/^\ufeff/u, '').trimEnd().split('\r\n');
  assert.equal(reportRows.length, 3, 'CSV has one row each for the label and panel');
  assert.match(reportRows[0], /Page pairing status,Pair confirmed at \(UTC\)/);
  assert.match(reportRows[1], /issued-reference\.pdf,2,revision-b\.pdf,2,confirmed manually/);
  for (const [index, expected] of [
    { x: 188, y: 63, width: 7, height: 7 },
    { x: 262, y: 344, width: 80, height: 56 },
  ].entries()) {
    const cells = reportRows[index + 1].split(',');
    assert.deepEqual(cells.slice(10, 14), [String(index + 1), 'modified', 'visual', 'unreviewed']);
    assert.equal(cells[26], 'aligned new page');
    for (const [key, column] of [['x', 22], ['y', 23], ['width', 24], ['height', 25]]) {
      assert.ok(Math.abs(Number(cells[column]) - expected[key]) < 4,
        `CSV region ${index + 1} ${key}: expected near ${expected[key]}, got ${cells[column]}`);
    }
  }

  // The marked-up copy is an editable PDF based on revision B, not merely a
  // picture or a report row. Independently reopen and check all visual regions.
  const markedOutcome = Promise.race([
    page.waitForEvent('download', { timeout: 30000 }).then(file => ({ file })),
    page.getByRole('alert').waitFor({ timeout: 30000 }).then(async () =>
      ({ error: await page.getByRole('alert').allTextContents() })),
  ]);
  await page.getByRole('button', { name: 'Export all detected regions on this pair' }).click();
  const markedResult = await markedOutcome;
  assert.ok(markedResult.file, `Revision markup export failed: ${markedResult.error?.join(' | ')}`);
  const markedBytes = new Uint8Array(await readFile(await markedResult.file.path()));
  await writeFile(join(directory, 'a102-revision-markups.pdf'), markedBytes);
  const markedTask = getDocument({ data: markedBytes.slice(), useSystemFonts: false });
  const markedReader = await markedTask.promise;
  assert.equal(markedReader.numPages, 4);
  const markedPage2 = await markedReader.getPage(2);
  const revisionText = (await markedPage2.getTextContent()).items.map(item => item.str).join(' ');
  assert.match(revisionText, /REV B PANEL/);
  const exportedRegions = (await markedPage2.getAnnotations()).filter(item =>
    item.subtype === 'Square' && item.contentsObj?.str?.includes('UNREVIEWED OcuDraw comparison difference'));
  assert.equal(exportedRegions.length, 2);
  assert.ok(exportedRegions.some(region => region.rect.every((value, index) =>
    Math.abs(value - [262, 392, 342, 448][index]) < 2)),
  'the blue panel revision must export as a local editable PDF region');
  for (const [index, region] of exportedRegions.entries()) {
    assert.match(region.contentsObj.str, new RegExp(`Change: ${index + 1} \\(`));
    assert.match(region.contentsObj.str, /Old source: issued-reference\.pdf — page 2/);
    assert.match(region.contentsObj.str, /New source: revision-b\.pdf — page 2/);
    assert.match(region.contentsObj.str, /Pairing: confirmed manually/);
    assert.equal(region.annotationFlags & (64 | 128), 0, 'revision region stays editable');
  }
  const preservedPage4 = await markedReader.getPage(4);
  assert.deepEqual(preservedPage4.view, [36, 40, 576, 760]);
  assert.equal(preservedPage4.rotate, 90);
  await markedTask.destroy();
  assert.deepEqual(errors, []);
  console.log(`Integration acceptance passed: four sheets, two saves, rotated CropBox count, ${changes} visual changes, ${reportedChanges} report rows, editable revision PDF`);
} finally {
  await browser?.close();
  await server?.close();
  if (!process.env.OCUDRAW_KEEP_ACCEPTANCE_ARTIFACTS) await rm(directory, { recursive: true, force: true });
  else console.log(`Acceptance artifacts: ${directory}`);
}
