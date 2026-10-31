// Scales read from the sheet, confirmed and saved: a real PDF made with
// pdf-lib (title block note, a plan and two details at other scales, a
// /Rotate 90 sheet with a nonzero-origin CropBox), read by PDF.js the way
// the app reads it, applied through the review rows, saved with the real
// saver, reopened with the real readers and measured with the app's chain.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { degrees, PDFDocument, PDFName, PDFArray, StandardFonts } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { leesPdfViewports } = await import('./pdf-viewports.js');
const { leesEigenViewports } = await import('./viewports-vp.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const { applyPageScale, calculateDistance, getMeasureScale } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const nv = await import('../annotations/named-viewports.js');
const { pageScaleStatus } = await import('../annotations/scale-entry.js');
const sp = await import('../annotations/scale-proposals.js');
const { beginUndoTransaction, endUndoTransaction, undo } = await import('../core/undo-manager.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-6 * Math.max(1, Math.abs(expected)), `${msg ?? ''} ${actual} != ${expected}`);

const W = 2592; // ARCH D, landscape
const H = 1728;

/** Text at a place in app space (top-left, y down) of an unrotated page. */
function text(page, font, str, x, y, size = 10) {
  page.drawText(str, { x, y: H - y - size, size, font });
}

async function makeSheets() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sheet = (titleScale) => {
    const page = pdf.addPage([W, H]);
    // Title block (right strip).
    text(page, font, 'PROJECT NO 2026-14', 2350, 1400);
    text(page, font, 'DRAWN BY JN', 2350, 1430);
    text(page, font, titleScale, 2350, 1460);
    text(page, font, 'SHEET NO A-501', 2350, 1500);
    return page;
  };
  const p1 = sheet('SCALE: 1/8" = 1\'-0"');
  text(p1, font, '1 FLOOR PLAN', 80, 1500, 14);
  text(p1, font, 'SCALE: 1/8" = 1\'-0"', 80, 1520);
  text(p1, font, '2 ENLARGED TOILET PLAN', 900, 1500, 14);
  text(p1, font, 'SCALE: 1/4" = 1\'-0"', 900, 1520);
  text(p1, font, '3 WALL SECTION', 1600, 1500, 14);
  text(p1, font, 'SCALE: 1 1/2" = 1\'-0"', 1600, 1520);

  // Page 2: /Rotate 90 with a CropBox at a nonzero origin. Shown it is
  // 600 wide and 800 high; the text is drawn turned so it reads level.
  const p2 = pdf.addPage([900, 700]);
  p2.setCropBox(50, 40, 800, 600); // [50 40 850 640]
  p2.setRotation(degrees(90));
  const at = (str, ax, ay, size = 10) => {
    // App (ax, ay) is user (50 + ay, 40 + ax) on a 90 degree page; the
    // baseline sits `size` below the top of the text.
    p2.drawText(str, { x: 50 + ay + size, y: 40 + ax, size, font, rotate: degrees(90) });
  };
  at('DRAWING NO 102', 400, 740);
  at('SCHAAL 1:50', 400, 760);
  at('DETAIL A', 60, 500, 14);
  at('SCALE 1:5', 60, 518);

  // Page 3: the same title block note as page 1, one plan.
  const p3 = sheet('SCALE: 1/8" = 1\'-0"');
  text(p3, font, '1 SECOND FLOOR PLAN', 80, 1500, 14);
  text(p3, font, 'SCALE: 1/8" = 1\'-0"', 80, 1520);
  return pdf.save();
}

function openDocument(extra = {}) {
  state.documents = [{ id: `scale-proposals-${Math.random()}`, filePath: 'C:/sp/input.pdf', pdfDoc: { numPages: 3 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [], measureScale: null,
    pageRotations: {}, _annotationPagesReady: new Set([1, 2, 3]), textEdits: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, ...extra }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.currentTool = 'select';
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function save(bytes) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/sp/output.pdf', { zonderHandtekeningVraag: true }), true);
  return saved;
}

async function reopen(bytes) {
  const lib = await PDFDocument.load(bytes);
  const doc = openDocument({ pdfViewports: leesPdfViewports(lib) });
  doc._eigenViewportsGelezen = false;
  nv.neemEigenViewportsOver(doc, leesEigenViewports(lib));
  invalidateScaleRegionCache();
  return { lib, doc };
}

const api = (doc) => ({
  applyPageScale, addViewports: nv.voegViewportsToe, beginUndo: beginUndoTransaction, endUndo: endUndoTransaction,
  viewName: (page) => nv.standaardViewportNaam(doc, page, 'View'),
});

test('a sheet with a title block note and two details: proposed, confirmed, saved and reopened', async () => {
  const bytes = await makeSheets();
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  try {
    const doc = openDocument({ pdfDoc: reader });
    await sp.scanAllPages(doc);

    // Page 1: the title block scale for the page, viewports for the details.
    const e1 = doc.scaleProposals[1];
    near(e1.pageScale.ratio, 96);
    assert.equal(e1.pageScale.source, 'titleBlock');
    assert.deepEqual(e1.views.map(v => [v.title, v.ratio]), [['2 ENLARGED TOILET PLAN', 48], ['3 WALL SECTION', 8]]);
    // Page 2 (rotated, cropped): the metric title block and its detail.
    const e2 = doc.scaleProposals[2];
    assert.equal(e2.pageScale.ratio, 50);
    assert.deepEqual(e2.views.map(v => [v.title, v.ratio]), [['DETAIL A', 5]]);
    const detail = e2.views[0].rect;
    assert.ok(detail.x <= 60 && detail.y < 40 && detail.y + detail.height >= 530 && detail.x + detail.width <= 600,
      `detail region in app space ${JSON.stringify(detail)}`);

    // Unconfirmed: nothing is applied, every page stays Scale not set.
    for (const page of [1, 2, 3]) {
      assert.equal(getMeasureScale(page, 300, 300).calibrated, false, `page ${page} uncalibrated`);
      assert.equal(pageScaleStatus(doc, page).kind, 'detected');
    }
    const before = calculateDistance(1000, 800, 1072, 800, 1);
    assert.equal(before.calibrated, false, 'page units while unconfirmed');

    // Rows: page 1 with the same note on page 3, page 2 with its detail.
    const rows = sp.reviewRows(doc);
    const page1 = rows.find(r => r.page === 1 && r.target === 'page');
    assert.deepEqual(sp.sameNoteRows(doc, page1).map(r => r.page), [1, 3]);
    const picks = [
      ...sp.sameNoteRows(doc, page1).map(row => ({ row })),
      ...rows.filter(r => r.page === 1 && r.target === 'view').map(row => ({ row })),
      ...rows.filter(r => r.page === 2 && r.target !== 'info').map(row => ({ row })),
    ];
    const depth = doc.undoStack.length;
    const result = sp.applyRows(doc, picks, api(doc));
    assert.equal(result.applied, 6);
    assert.deepEqual(result.invalid, []);
    assert.equal(doc.undoStack.length, depth + 1, 'one undo step');
    assert.equal(pageScaleStatus(doc, 1).kind, 'set');
    assert.equal(pageScaleStatus(doc, 1).source, `Title block: SCALE: 1/8" = 1'-0"`);
    assert.equal(sp.pendingProposals(doc, 1).views.length, 0);

    const check = (d) => {
      // Floor plan (page scale 1:96): 72 pt = 1 in on paper = 8 ft.
      const plan = calculateDistance(300, 800, 372, 800, 1);
      assert.equal(plan.unit, 'ft'); near(plan.value, 8, 'floor plan');
      // Enlarged plan (1:48): 4 ft.
      const toilet = calculateDistance(1000, 800, 1072, 800, 1);
      assert.equal(toilet.unit, 'ft'); near(toilet.value, 4, 'enlarged plan');
      // Wall section (1:8): 8 in.
      const section = calculateDistance(1700, 800, 1772, 800, 1);
      assert.equal(section.unit, 'ft'); near(section.value, 8 / 12, 'wall section');
      // Page 3, same note applied: 1:96.
      near(calculateDistance(300, 800, 372, 800, 3).value, 8, 'page 3');
      // Page 2: the detail at 1:5, the rest at 1:50 (72 pt = 25.4 mm on paper).
      const inDetail = calculateDistance(200, 200, 272, 200, 2);
      assert.equal(inDetail.unit, 'mm'); near(inDetail.value, 25.4 * 5, 'detail A');
      const outside = calculateDistance(200, 650, 272, 650, 2);
      assert.equal(outside.unit, 'mm'); near(outside.value, 25.4 * 50, 'page 2 outside the detail');
      const regions = nv.alleViewports(d);
      assert.deepEqual(regions.map(r => r.label).sort(), ['2 ENLARGED TOILET PLAN', '3 WALL SECTION', 'DETAIL A']);
      assert.equal(regions.find(r => r.label === 'DETAIL A').source, 'View DETAIL A: SCALE 1:5');
    };
    invalidateScaleRegionCache();
    check(doc);

    // Save, reopen, measure again; a second save does not duplicate.
    const first = await save(bytes);
    const { lib, doc: reopened } = await reopen(first);
    check(reopened);
    assert.equal(pageScaleStatus(reopened, 1).source, `Title block: SCALE: 1/8" = 1'-0"`, 'source survives the save');
    const vp = lib.getPages()[0].node.lookup(PDFName.of('VP'));
    assert.ok(vp instanceof PDFArray);
    assert.equal(vp.size(), 3, 'page scale + two viewports');
    const page2 = lib.getPages()[1];
    assert.equal(page2.getRotation().angle, 90);
    const second = await PDFDocument.load(await save(first));
    assert.equal(second.getPages()[0].node.lookup(PDFName.of('VP')).size(), 3);
    const names = second.getPages()[1].node.lookup(PDFName.of('VP')).asArray()
      .map(r => decodePdfTextObject(second.context.lookup(r).lookup(PDFName.of('Name'))));
    assert.ok(names.includes('DETAIL A'));
  } finally {
    await task.destroy();
  }
});

test('rejecting keeps the page uncalibrated; undo of an apply removes scales and viewports', async () => {
  const bytes = await makeSheets();
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  try {
    const doc = openDocument({ pdfDoc: reader });
    await sp.scanPageScales(doc, 1);
    await sp.scanPageScales(doc, 2);
    sp.rejectRows(doc, sp.reviewRows(doc, [1]));
    assert.equal(pageScaleStatus(doc, 1).kind, 'none');
    assert.equal(getMeasureScale(1, 300, 300).calibrated, false);

    // An edited row: the user typed 1:20 for detail A.
    const rows = sp.reviewRows(doc, [2]).filter(r => r.target !== 'info');
    const detail = rows.find(r => r.target === 'view');
    assert.equal(sp.rowScale(detail, 'not a scale'), null);
    const r = sp.applyRows(doc, rows.map(row => ({ row, typed: row === detail ? '1:20' : undefined })), api(doc));
    assert.equal(r.applied, 2);
    invalidateScaleRegionCache();
    near(calculateDistance(200, 200, 272, 200, 2).value, 25.4 * 20, 'edited scale');
    await undo();
    invalidateScaleRegionCache();
    assert.equal(nv.alleViewports(doc).length, 0);
    assert.equal(getMeasureScale(2, 200, 650).calibrated, false);
  } finally {
    await task.destroy();
  }
});
