// Named viewports: a rectangle with its own name and scale, saved as a
// standard /VP entry (/Type /Viewport /BBox /Name /Measure) owned by OcuDraw
// (/OPS_Viewport true) instead of a visible dashed Square annotation. Real
// PDF bytes through the real saver, reopened with the real readers and
// measured with the app's scale chain.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { degrees, PDFArray, PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { leesPdfViewports, puntNaarAppRuimte } = await import('./pdf-viewports.js');
const { leesEigenViewports, puntUitAppRuimte } = await import('./viewports-vp.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const { applyPageScale, calculateDistance } = await import('../annotations/measurement.js');
const { ratioPixelsPerUnit } = await import('../annotations/scale-entry.js');
const { createScaleRegion, invalidateScaleRegionCache, getScaleFromRegion } = await import('../annotations/scale-region.js');
const { createAnnotation } = await import('../annotations/factory.js');
const nv = await import('../annotations/named-viewports.js');
const { hiddenInView, hiddenInOutput, pickableInView } = await import('../annotations/view-filter-rules.js');
const { viewportsZichtbaarBij } = await import('../annotations/viewport-zichtbaarheid.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const undoManager = await import('../core/undo-manager.js');

const near = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-6 * Math.max(1, Math.abs(expected)), `${msg ?? ''} ${actual} != ${expected}`);

const FT_48 = { pixelsPerUnit: ratioPixelsPerUnit(48, 'ft'), unit: 'ft', method: 'ratio', scaleRatio: '1:48' };

function openDocument(extra = {}) {
  state.documents = [{ id: `named-vp-${Math.random()}`, filePath: 'C:/vp/input.pdf', pdfDoc: { numPages: 1 },
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
  assert.equal(await savePDF('C:/vp/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

/** Reopen as the loader does: PDF viewports, then OcuDraw's viewports into the model. */
async function reopen(bytes, extra = {}) {
  const lib = await PDFDocument.load(bytes);
  const doc = openDocument({ pdfViewports: leesPdfViewports(lib), ...extra });
  doc._eigenViewportsGelezen = false;
  nv.neemEigenViewportsOver(doc, leesEigenViewports(lib));
  invalidateScaleRegionCache();
  return { lib, doc };
}

function vpDicts(lib, pageIndex = 0) {
  const arr = lib.getPages()[pageIndex].node.lookup(PDFName.of('VP'));
  if (!(arr instanceof PDFArray)) return [];
  return Array.from({ length: arr.size() }, (_, i) => arr.lookup(i));
}
const flag = (d, key) => d.lookup(PDFName.of(key))?.asBoolean?.() === true;
const ownVps = (lib, i = 0) => vpDicts(lib, i).filter(d => flag(d, 'OPS_Viewport'));
const pageVps = (lib, i = 0) => vpDicts(lib, i).filter(d => flag(d, 'OPS_PageScale'));
const nameOf = (d) => decodePdfTextObject(d.lookup(PDFName.of('Name')));
const bboxOf = (d) => d.lookup(PDFName.of('BBox')).asArray().map(n => n.asNumber());
const squares = (lib, i = 0) => {
  const annots = lib.getPages()[i].node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  return annots.asArray().map(r => lib.context.lookup(r)).filter(d => d.lookup(PDFName.of('Subtype'))?.toString() === '/Square');
};

function measure(page, x1, y1, x2, y2) {
  return createAnnotation({ type: 'measureDistance', page, startX: x1, startY: y1, endX: x2, endY: y2 });
}

/** Add a viewport through the same path as the Add Viewport tool + Apply. */
function addViewport(rect, values) {
  const doc = state.documents[state.activeDocumentIndex];
  const ann = createScaleRegion({ page: 1, ...rect, scaleString: '1:100', units: 'mm', label: '' });
  doc.annotations.push(ann);
  const r = nv.pasViewportToe(ann.id, values, { isNew: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  return ann;
}

test('two named viewports at different scales and a page scale survive save and reopen, without duplicates', async () => {
  const src = await PDFDocument.create();
  src.addPage([1224, 792]);
  const doc = openDocument();
  applyPageScale(FT_48, [1]);
  addViewport({ x: 100, y: 100, width: 300, height: 200 }, { label: 'Detail A', scaleString: '1/2" = 1\'-0"', units: 'ft', precision: 3 });
  addViewport({ x: 600, y: 300, width: 200, height: 200 }, { label: 'Detail B', scaleString: '1:20', units: 'mm', precision: 1 });
  // Nested inside Detail A: innermost wins.
  addViewport({ x: 150, y: 150, width: 50, height: 50 }, { label: 'Inner', scaleString: '1:10', units: 'mm' });
  doc.annotations.push(measure(1, 200, 250, 236, 250)); // in Detail A only
  doc.annotations.push(measure(1, 650, 400, 722, 400)); // in Detail B
  doc.annotations.push(measure(1, 900, 700, 936, 700)); // outside: page scale
  doc.annotations.push(measure(1, 160, 175, 188.8, 175)); // in Inner
  invalidateScaleRegionCache();

  const first = await save(await src.save());
  const lib = await PDFDocument.load(first);
  assert.equal(ownVps(lib).length, 3);
  assert.equal(pageVps(lib).length, 1, 'the page scale is still written');
  assert.equal(squares(lib).length, 0, 'no visible Square for a viewport');
  // Largest first, innermost last.
  assert.deepEqual(ownVps(lib).map(nameOf), ['Detail A', 'Detail B', 'Inner']);
  const a = ownVps(lib)[0];
  assert.equal(a.lookup(PDFName.of('Type')).toString(), '/Viewport');
  // App y is from the top: 792 - (100 + 200) = 492.
  assert.deepEqual(bboxOf(a), [100, 492, 400, 692]);
  const m = a.lookup(PDFName.of('Measure'));
  assert.equal(m.lookup(PDFName.of('Subtype')).toString(), '/RL');
  assert.equal(decodePdfTextObject(m.lookup(PDFName.of('R'))), '1 in = 2 ft');
  // 1:24 in ft: 36 pt per foot, so 1/36 ft per point; precision 3 = /D 1000.
  near(m.lookup(PDFName.of('X')).lookup(0).lookup(PDFName.of('C')).asNumber(), 1 / 36);
  assert.equal(m.lookup(PDFName.of('X')).lookup(0).lookup(PDFName.of('D')).asNumber(), 1000);

  const { doc: reopened } = await reopen(first);
  const regions = nv.viewportsOpPagina(reopened, 1);
  assert.deepEqual(regions.map(r => r.label).sort(), ['Detail A', 'Detail B', 'Inner']);
  const detailA = regions.find(r => r.label === 'Detail A');
  assert.deepEqual([detailA.x, detailA.y, detailA.width, detailA.height], [100, 100, 300, 200]);
  assert.equal(detailA.scaleString, '1:24');
  assert.equal(detailA.units, 'ft');
  assert.equal(detailA.precision, 3);
  assert.equal(regions.find(r => r.label === 'Detail B').precision, 1);
  assert.equal(reopened.pdfViewports[1].length, 1, 'only the page scale is a PDF viewport; ours are the model');

  const dA = calculateDistance(200, 250, 236, 250, 1);
  assert.equal(dA.unit, 'ft'); near(dA.value, 1, 'Detail A (36 pt = 1 ft at 1:24)');
  const dB = calculateDistance(650, 400, 722, 400, 1);
  assert.equal(dB.unit, 'mm'); near(dB.value, 25.4 * 20, 'Detail B');
  const dOut = calculateDistance(900, 700, 936, 700, 1);
  assert.equal(dOut.unit, 'ft'); near(dOut.value, 2, 'page scale outside the viewports');
  const dIn = calculateDistance(160, 175, 188.8, 175, 1);
  assert.equal(dIn.unit, 'mm'); near(dIn.value, 28.8 * 25.4 / 72 * 10, 'innermost wins');

  // Second and third save: replaced, not duplicated; the model ids are kept.
  reopened.pageScales = { 1: FT_48 };
  const second = await PDFDocument.load(await save(first));
  assert.equal(ownVps(second).length, 3);
  assert.equal(pageVps(second).length, 1);
  const ids = ownVps(second).map(d => decodePdfTextObject(d.lookup(PDFName.of('OPS_Id'))));
  assert.deepEqual(new Set(ids), new Set(regions.map(r => r.id)));
  const { doc: again } = await reopen(await second.save());
  assert.equal(nv.alleViewports(again).length, 3);
});

test('a feet-inches viewport precision is saved, reopened and shown inside the viewport', async () => {
  const src = await PDFDocument.create();
  src.addPage([1224, 792]);
  openDocument();
  const vp = addViewport({ x: 100, y: 100, width: 300, height: 200 },
    { label: 'Detail F', scaleString: '1:48', units: 'ft', precision: 'fi8',
      equation: { paperValue: 0.25, paperUnit: 'in', realValue: 1, realUnit: 'ft' } });
  assert.equal(vp.precision, 'fi8');
  assert.deepEqual(vp.equation, { paperValue: 0.25, paperUnit: 'in', realValue: 1, realUnit: 'ft' });
  const lib = await PDFDocument.load(await save(await src.save()));
  assert.equal(decodePdfTextObject(ownVps(lib)[0].lookup(PDFName.of('OPS_Precision'))), 'fi8');
  const { doc } = await reopen(await lib.save());
  const [region] = nv.viewportsOpPagina(doc, 1);
  assert.equal(region.precision, 'fi8');
  // 18 pt per foot: 18 * 10.5625 pt is 10'-6 3/4" at 1/8" (10'-6 11/16" at 1/16").
  const d = calculateDistance(150, 150, 150 + 18 * 10.5625, 150, 1);
  assert.equal(d.precision, 'fi8');
  assert.equal(getScaleFromRegion(1, 150, 150).precision, 'fi8');
  // An equation that does not give the viewport's scale is not stored.
  const other = nv.controleerViewportInvoer({ label: 'X', scaleString: '1:96', units: 'ft',
    equation: { paperValue: 0.25, paperUnit: 'in', realValue: 1, realUnit: 'ft' } });
  assert.equal(other.waarden.equation, undefined);
  assert.equal(nv.controleerViewportInvoer({ label: 'X', scaleString: '1:20', units: 'mm', precision: 'fi8' })
    .waarden.precision, undefined, 'no feet-inches in mm');
});

test('a rotated page with a nonzero-origin CropBox, and an in-app rotation, keep the viewport in place', async () => {
  const src = await PDFDocument.create();
  const page = src.addPage([800, 600]);
  page.setCropBox(100, 50, 600, 500); // [100 50 700 550]
  page.setRotation(degrees(90));
  src.addPage([600, 400]); // page 2: rotated in the app only
  const bytes = await src.save();
  const doc = openDocument({ pdfDoc: { numPages: 2 }, pageRotations: { 2: 90 } });
  // Page 1 in app space is 500 wide, 600 high.
  addViewport({ x: 40, y: 70, width: 120, height: 90 }, { label: 'Rotated', scaleString: '1:50', units: 'mm' });
  const onTwo = createScaleRegion({ page: 2, x: 30, y: 60, width: 100, height: 50, scaleString: '1:25', units: 'mm', label: 'App rotated' });
  doc.annotations.push(onTwo);
  const first = await save(bytes);

  // The BBox matches what pdf.js (the page renderer) maps the app rectangle to.
  const task = pdfjs.getDocument({ data: first.slice(), isEvalSupported: false, verbosity: 0 });
  try {
    const reader = await task.promise;
    const lib = await PDFDocument.load(first);
    for (const [pageNum, rect] of [[1, { x: 40, y: 70, width: 120, height: 90 }], [2, onTwo]]) {
      const vpPage = (await reader.getPage(pageNum)).getViewport({ scale: 1 });
      const c1 = vpPage.convertToPdfPoint(rect.x, rect.y);
      const c2 = vpPage.convertToPdfPoint(rect.x + rect.width, rect.y + rect.height);
      const expected = [Math.min(c1[0], c2[0]), Math.min(c1[1], c2[1]), Math.max(c1[0], c2[0]), Math.max(c1[1], c2[1])];
      const [own] = ownVps(lib, pageNum - 1);
      bboxOf(own).forEach((v, i) => near(v, expected[i], `page ${pageNum} BBox[${i}]`));
    }
    assert.equal(lib.getPages()[1].getRotation().angle, 90, 'the in-app rotation was written');
  } finally {
    await task.destroy();
  }

  const { doc: reopened } = await reopen(first, { pdfDoc: { numPages: 2 } });
  const [r1] = nv.viewportsOpPagina(reopened, 1);
  [r1.x, r1.y, r1.width, r1.height].forEach((v, i) => near(v, [40, 70, 120, 90][i]));
  const [r2] = nv.viewportsOpPagina(reopened, 2);
  [r2.x, r2.y, r2.width, r2.height].forEach((v, i) => near(v, [30, 60, 100, 50][i]));
  const s = getScaleFromRegion(1, 100, 100);
  near(s.pixelsPerUnit, 72 / 25.4 / 50);
  // Second save from the reopened bytes: no in-app rotation anymore, same place.
  const lib2 = await PDFDocument.load(await save(first));
  assert.equal(ownVps(lib2, 0).length, 1);
  assert.equal(ownVps(lib2, 1).length, 1);
  assert.deepEqual(bboxOf(ownVps(lib2, 1)[0]), bboxOf(ownVps(await PDFDocument.load(first), 1)[0]));
});

test('app-space conversion is the inverse of the reader for every rotation', () => {
  const view = [100, 50, 700, 550];
  for (const rot of [0, 90, 180, 270, 450, -90]) {
    const [x, y] = puntUitAppRuimte(37, 81, view, rot);
    const [ax, ay] = puntNaarAppRuimte(x, y, view, rot);
    near(ax, 37, `rotation ${rot} x`);
    near(ay, 81, `rotation ${rot} y`);
  }
});

test('a foreign /VP survives, deleting a viewport removes only ours', async () => {
  const src = await PDFDocument.create();
  const page = src.addPage([1224, 792]);
  page.node.set(PDFName.of('VP'), src.context.obj([
    src.context.obj({ Type: 'Viewport', BBox: [100, 100, 300, 300], Name: PDFString.of('CAD detail'),
      Measure: src.context.obj({ Type: 'Measure', Subtype: 'RL', R: PDFString.of('1:50'),
        X: [src.context.obj({ U: PDFString.of('mm'), C: 50 * 25.4 / 72, D: 1 })] }) }),
  ]));
  const bytes = await src.save();
  const lib0 = await PDFDocument.load(bytes);
  openDocument({ pdfViewports: leesPdfViewports(lib0) });
  addViewport({ x: 600, y: 100, width: 200, height: 100 }, { label: 'Ours', scaleString: '1:20', units: 'mm' });
  const first = await save(bytes);
  const lib1 = await PDFDocument.load(first);
  assert.equal(vpDicts(lib1).length, 2);
  assert.deepEqual(vpDicts(lib1).map(nameOf), ['CAD detail', 'Ours']);

  // The CAD viewport still measures inside its BBox (app y 792 - 200 = 592).
  const { doc: reopened } = await reopen(first);
  const cad = calculateDistance(150, 592, 222, 592, 1);
  near(cad.value, 25.4 * 50);
  assert.equal(nv.verwijderViewports(nv.alleViewports(reopened).map(v => v.id)), 1);
  const lib2 = await PDFDocument.load(await save(first));
  assert.deepEqual(vpDicts(lib2).map(nameOf), ['CAD detail']);
  near(vpDicts(lib2)[0].lookup(PDFName.of('Measure')).lookup(PDFName.of('X')).lookup(0).lookup(PDFName.of('C')).asNumber(), 50 * 25.4 / 72);
});

test('while the file viewports are not read yet, a save keeps them', async () => {
  const src = await PDFDocument.create();
  src.addPage([600, 600]);
  openDocument();
  addViewport({ x: 10, y: 10, width: 100, height: 100 }, { label: 'From file', scaleString: '1:20', units: 'mm' });
  const first = await save(await src.save());
  // A fresh document whose background read has not finished: the model is empty.
  const doc = openDocument();
  doc._eigenViewportsGelezen = false;
  addViewport({ x: 200, y: 200, width: 100, height: 100 }, { label: 'New', scaleString: '1:50', units: 'mm' });
  const lib = await PDFDocument.load(await save(first));
  assert.deepEqual(ownVps(lib).map(nameOf).sort(), ['From file', 'New']);
});

test('a legacy scale-region Square migrates to a viewport and measures the same', async () => {
  const src = await PDFDocument.create();
  const page = src.addPage([800, 600]);
  page.setCropBox(100, 50, 600, 500);
  page.setRotation(degrees(90));
  // What the old saver wrote for a region: a dashed Square with OPS_ keys.
  const square = src.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [200, 150, 400, 300], C: [1, 0.6, 0],
    Contents: PDFString.of('Plattegrond'), OPS_Subtype: PDFString.of('scaleRegion'),
    OPS_ScaleString: PDFString.of('1:50'), OPS_Units: PDFString.of('mm'), OPS_Label: PDFString.of('Plattegrond'),
    BS: src.context.obj({ W: 1.5, S: PDFName.of('D'), D: [6, 3] }),
  });
  page.node.set(PDFName.of('Annots'), src.context.obj([src.context.register(square)]));
  const bytes = await src.save();

  // Load the Square the way the loader does (pdf.js + the converter).
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  let legacy;
  try {
    const p1 = await (await task.promise).getPage(1);
    const raw = (await p1.getAnnotations()).find(a => a.subtype === 'Square');
    legacy = await convertPdfAnnotation(raw, 1, p1.getViewport({ scale: 1 }), new Map(),
      await extractAnnotationColors(1, await PDFDocument.load(bytes)));
  } finally {
    await task.destroy();
  }
  assert.equal(legacy.type, 'scaleRegion');
  assert.equal(legacy.label, 'Plattegrond');
  const doc = openDocument({ annotations: [legacy] });
  const cx = legacy.x + legacy.width / 2;
  const cy = legacy.y + legacy.height / 2;
  const before = calculateDistance(cx - 10, cy, cx + 10, cy, 1);
  near(before.value, 20 * 25.4 / 72 * 50, 'legacy region scale');
  assert.equal(doc.annotations.length, 1);

  const saved = await PDFDocument.load(await save(bytes));
  assert.equal(squares(saved).length, 0, 'the visible Square is gone');
  assert.equal(ownVps(saved).length, 1);
  assert.equal(nameOf(ownVps(saved)[0]), 'Plattegrond');
  // The /BBox is the old Square's /Rect: same place in the file.
  bboxOf(ownVps(saved)[0]).forEach((v, i) => near(v, [200, 150, 400, 300][i], `BBox[${i}]`));

  const { doc: reopened } = await reopen(await saved.save());
  const [region] = nv.alleViewports(reopened);
  [region.x, region.y, region.width, region.height].forEach((v, i) =>
    near(v, [legacy.x, legacy.y, legacy.width, legacy.height][i]));
  const after = calculateDistance(cx - 10, cy, cx + 10, cy, 1);
  assert.equal(after.unit, before.unit);
  near(after.value, before.value, 'measures identically after migration');
});

test('rename, rescale and delete are one undo step each and recalculate the measurements', async () => {
  const doc = openDocument();
  applyPageScale(FT_48, [1]);
  const vp = addViewport({ x: 0, y: 0, width: 200, height: 200 }, { label: 'Plan', scaleString: '1:100', units: 'mm' });
  const m = measure(1, 10, 10, 82, 10);
  doc.annotations.push(m);
  nv.pasViewportToe(vp.id, { label: 'Plan', scaleString: '1:100', units: 'mm' });
  near(m.measureValue, 2540, 'inside the viewport at 1:100');
  const depth = doc.undoStack.length;

  assert.equal(nv.hernoemViewport(vp.id, '  Ground floor ').ok, true);
  assert.equal(vp.label, 'Ground floor');
  assert.equal(doc.undoStack.length, depth + 1);
  assert.equal(nv.hernoemViewport(vp.id, '   ').fout, 'naam', 'an empty name is refused');

  assert.equal(nv.pasViewportToe(vp.id, { label: 'Ground floor', scaleString: '1:50', units: 'mm' }).ok, true);
  near(m.measureValue, 1270, 'rescaled');
  assert.equal(doc.undoStack.length, depth + 2, 'rescale + measurements = one step');

  assert.equal(nv.verwijderViewports([vp.id]), 1);
  near(m.measureValue, 4, 'falls back to the page scale (72 pt at 18 pt/ft)');
  assert.equal(doc.undoStack.length, depth + 3);

  await undoManager.undo(); // delete
  invalidateScaleRegionCache();
  const back = nv.alleViewports(doc)[0];
  assert.equal(back.label, 'Ground floor');
  near(doc.annotations.find(a => a.id === m.id).measureValue, 1270);
  await undoManager.undo(); // rescale
  invalidateScaleRegionCache();
  assert.equal(nv.alleViewports(doc)[0].scaleString, '1:100');
  near(doc.annotations.find(a => a.id === m.id).measureValue, 2540);
  await undoManager.undo(); // rename
  assert.equal(nv.alleViewports(doc)[0].label, 'Plan');
  await undoManager.redo();
  assert.equal(nv.alleViewports(doc)[0].label, 'Ground floor');
});

test('clear all for the page or the document, one undo step', async () => {
  const doc = openDocument({ pdfDoc: { numPages: 2 } });
  addViewport({ x: 0, y: 0, width: 50, height: 50 }, { label: 'A', scaleString: '1:10', units: 'mm' });
  addViewport({ x: 60, y: 0, width: 50, height: 50 }, { label: 'B', scaleString: '1:10', units: 'mm' });
  doc.annotations.push(createScaleRegion({ page: 2, x: 0, y: 0, width: 50, height: 50, scaleString: '1:5', units: 'mm', label: 'C' }));
  assert.equal(nv.wisViewports('page', 1), 2);
  assert.deepEqual(nv.alleViewports(doc).map(v => v.label), ['C']);
  await undoManager.undo();
  assert.equal(nv.alleViewports(doc).length, 3);
  assert.equal(nv.wisViewports('document'), 3);
  assert.equal(nv.alleViewports(doc).length, 0);
  await undoManager.undo();
  assert.equal(nv.alleViewports(doc).length, 3);
});

test('the Apply Scale to Viewport input: a name is required, scales are 1:N or architectural', () => {
  assert.deepEqual(nv.controleerViewportInvoer({ label: '', scaleString: '1:50', units: 'mm' }), { ok: false, fout: 'naam' });
  assert.equal(nv.controleerViewportInvoer({ label: 'X', scaleString: '2:1', units: 'mm' }).fout, 'schaal');
  assert.equal(nv.controleerViewportInvoer({ label: 'X', scaleString: '1:50', units: 'yd' }).fout, 'eenheid');
  assert.deepEqual(nv.controleerViewportInvoer({ label: ' X ', scaleString: '1/4" = 1\'-0"', units: 'ft', precision: 2 }),
    { ok: true, waarden: { label: 'X', scaleString: '1:48', units: 'ft', precision: 2 } });
  const doc = openDocument();
  doc.annotations.push(createScaleRegion({ page: 1, x: 0, y: 0, width: 5, height: 5, label: 'Viewport 1' }));
  assert.equal(nv.standaardViewportNaam(doc, 1), 'Viewport 2');
  assert.equal(nv.standaardViewportNaam(doc, 2), 'Viewport 1');
});

test('viewports are highlighted only while a measure tool is active, and never printed', () => {
  for (const tool of ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle', 'count', 'calibrationPick', 'scaleRegion']) {
    assert.equal(viewportsZichtbaarBij(tool), true, tool);
  }
  for (const tool of ['select', 'hand', 'box', 'line', null, undefined]) {
    assert.equal(viewportsZichtbaarBij(tool), false, String(tool));
  }
  const vp = { type: 'scaleRegion', page: 1 };
  const box = { type: 'box', page: 1 };
  const bron = (zichtbaar) => ({ doc: null, hiddenTypes: new Set(), isStatusHidden: () => false, viewportsZichtbaar: zichtbaar });
  assert.equal(hiddenInView(vp, bron(false)), true);
  assert.equal(pickableInView(vp, bron(false)), false, 'not clickable when not drawn');
  assert.equal(hiddenInView(vp, bron(true)), false);
  assert.equal(hiddenInOutput(vp, bron(true)), true, 'never in print or export');
  assert.equal(hiddenInView(box, bron(false)), false, 'other markups are unaffected');
  assert.equal(hiddenInOutput(box, bron(false)), false);
});

test('the viewport strings exist in English and Dutch', () => {
  const read = (lang, ns) => JSON.parse(readFileSync(new URL(`../i18n/locales/${lang}/${ns}.json`, import.meta.url), 'utf8'));
  const en = read('en', 'properties').viewports;
  const nl = read('nl', 'properties').viewports;
  assert.deepEqual(Object.keys(nl).sort(), Object.keys(en).sort());
  for (const lang of ['en', 'nl']) {
    const c = read(lang, 'ribbon').comment;
    assert.ok(c.addViewport && c.addViewportTitle, lang);
  }
  // The source uses only keys that exist.
  const used = new Set();
  for (const file of ['../solid/components/dialogs/ScaleRegionDialog.jsx', '../solid/components/left-panel/panels/MeasurementsPanel.jsx']) {
    for (const m of readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/t\('viewports\.([a-zA-Z]+)'/g)) used.add(m[1]);
  }
  for (const key of used) assert.ok(key in en, `viewports.${key}`);
});

test('Add Viewport: drag a rectangle, Shift keeps it square toward the cursor', async () => {
  const { viewportRechthoek } = await import('../tools/tools/scale-region-tool.js');
  assert.deepEqual(viewportRechthoek(100, 100, 160, 130), { x: 100, y: 100, width: 60, height: 30 });
  assert.deepEqual(viewportRechthoek(100, 100, 40, 130), { x: 40, y: 100, width: 60, height: 30 });
  assert.deepEqual(viewportRechthoek(100, 100, 160, 130, true), { x: 100, y: 100, width: 60, height: 60 });
  assert.deepEqual(viewportRechthoek(100, 100, 80, 20, true), { x: 20, y: 20, width: 80, height: 80 });
});
