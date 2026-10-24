// Set Scale's precision and equation in the PDF: decimals, inch fractions
// and feet-inches are written as ISO 32000-1 §12.9 NumberFormat arrays in
// /D (fractions as /F /F with the denominator in /D, feet-inches as feet
// truncated then inches), the precision itself as /OPS_Precision, the typed
// equation as /R. Real bytes through the real saver and /VP reader.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { leesPdfViewports } = await import('./pdf-viewports.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const { paginaSchaal } = await import('../annotations/schaal-op-punt.js');
const { applyPageScale, calculateDistance, formatMeasurement } = await import('../annotations/measurement.js');
const { parseScaleEquation, scaleDataFromEquation, equationFromScale } = await import('../annotations/scale-presets.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');

function openDocument(extra = {}) {
  state.documents = [{ id: `precision-${Math.random()}`, filePath: 'C:/scale/input.pdf', pdfDoc: { numPages: 3 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [], measureScale: null,
    pageRotations: {}, _annotationPagesReady: new Set([1, 2, 3]), textEdits: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0, ...extra }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureRounding = 'none';
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
  assert.equal(await savePDF('C:/scale/output.pdf', { zonderHandtekeningVraag: true }), true);
  return saved;
}

async function threePagePdf() {
  const src = await PDFDocument.create();
  for (let i = 0; i < 3; i++) src.addPage([1224, 792]);
  return src.save();
}

function ownMeasure(lib, pageIndex) {
  const arr = lib.getPages()[pageIndex].node.lookup(PDFName.of('VP'));
  assert.ok(arr instanceof PDFArray);
  const vp = Array.from({ length: arr.size() }, (_, i) => arr.lookup(i))
    .find(d => d.lookup(PDFName.of('OPS_PageScale'))?.asBoolean?.() === true);
  return { vp, measure: vp.lookup(PDFName.of('Measure')) };
}

const formats = (measure, key) => {
  const arr = measure.lookup(PDFName.of(key));
  return Array.from({ length: arr.size() }, (_, i) => {
    const nf = arr.lookup(i);
    const d = nf.lookup(PDFName.of('D'));
    return { U: decodePdfTextObject(nf.lookup(PDFName.of('U'))), C: nf.lookup(PDFName.of('C')).asNumber(),
      F: nf.lookup(PDFName.of('F')).toString(), D: d ? d.asNumber() : null };
  });
};

test('feet-inches, inch fractions and decimals are written as NumberFormats and read back', async () => {
  openDocument();
  const quarter = parseScaleEquation('1/4', 'in', '1', 'ft');
  applyPageScale(scaleDataFromEquation(quarter, { precision: 'fi16' }), [1]);
  applyPageScale(scaleDataFromEquation(parseScaleEquation('1', 'in', '8', 'in'), { precision: 'f8' }), [2]);
  applyPageScale(scaleDataFromEquation(parseScaleEquation('1', 'mm', '0.1', 'm'), { precision: 3 }), [3]);
  const bytes = await save(await threePagePdf());
  const lib = await PDFDocument.load(bytes);

  const p1 = ownMeasure(lib, 0);
  assert.equal(decodePdfTextObject(p1.measure.lookup(PDFName.of('R'))), '0.25 in = 1 ft');
  assert.deepEqual(formats(p1.measure, 'D'), [
    { U: 'ft', C: 1, F: '/T', D: null },
    { U: 'in', C: 12, F: '/F', D: 16 },
  ]);
  assert.equal(decodePdfTextObject(p1.vp.lookup(PDFName.of('OPS_Precision'))), 'fi16');
  assert.deepEqual(formats(ownMeasure(lib, 1).measure, 'D'), [{ U: 'in', C: 1, F: '/F', D: 8 }]);
  const p3 = ownMeasure(lib, 2);
  assert.deepEqual(formats(p3.measure, 'D'), [{ U: 'm', C: 1, F: '/D', D: 1000 }]);
  assert.equal(decodePdfTextObject(p3.measure.lookup(PDFName.of('R'))), '1 mm = 0.1 m');

  // Reopened: the page scales carry their precision and equation again.
  const reopened = { annotations: [], pdfViewports: leesPdfViewports(lib), measureScale: null };
  assert.equal(paginaSchaal(reopened, 1).precision, 'fi16');
  assert.equal(paginaSchaal(reopened, 2).precision, 'f8');
  assert.equal(paginaSchaal(reopened, 3).precision, 3);
  assert.deepEqual(equationFromScale(paginaSchaal(reopened, 1)), quarter);

  openDocument({ pdfViewports: reopened.pdfViewports });
  assert.equal(formatMeasurement(calculateDistance(0, 0, 18 * 12.375, 0, 1)), '12\'-4 1/2"');
  assert.equal(formatMeasurement(calculateDistance(0, 0, 72 / 8 * 10.5, 0, 2)), '10 1/2"');
  assert.equal(formatMeasurement(calculateDistance(0, 0, 72 / 25.4, 0, 3)), '0.100 m');
});

test('a feet-inch precision on an inch scale converts to feet first', async () => {
  openDocument();
  applyPageScale(scaleDataFromEquation(parseScaleEquation('1', 'in', '48', 'in'), { precision: 'fi4' }), [1]);
  const lib = await PDFDocument.load(await save(await threePagePdf()));
  const [feet, inches] = formats(ownMeasure(lib, 0).measure, 'D');
  assert.equal(feet.U, 'ft');
  assert.ok(Math.abs(feet.C - 1 / 12) < 1e-12);
  assert.deepEqual(inches, { U: 'in', C: 12, F: '/F', D: 4 });
});

test('a page scale without a precision keeps the imperial default after reopening', async () => {
  openDocument();
  applyPageScale({ pixelsPerUnit: 18, unit: 'ft', method: 'ratio', scaleRatio: '1:48' }, [1]);
  const lib = await PDFDocument.load(await save(await threePagePdf()));
  const { vp, measure } = ownMeasure(lib, 0);
  assert.equal(vp.lookup(PDFName.of('OPS_Precision')), undefined);
  assert.deepEqual(formats(measure, 'D'), [{ U: 'ft', C: 1, F: '/D', D: 100 }]);
  assert.equal(decodePdfTextObject(measure.lookup(PDFName.of('R'))), '1 in = 4 ft');
  const reopened = { annotations: [], pdfViewports: leesPdfViewports(lib), measureScale: null };
  assert.equal(paginaSchaal(reopened, 1).precision, undefined);
  openDocument({ pdfViewports: reopened.pdfViewports });
  assert.equal(formatMeasurement(calculateDistance(0, 0, 36, 0, 1)), '2\'-0"');
});
