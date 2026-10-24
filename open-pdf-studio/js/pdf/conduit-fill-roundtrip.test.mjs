// Conduit fill on real PDF bytes: a conduit run with conductors, saved by the
// real saver and reopened by PDF.js + the annotation converter, keeps its
// conductors, its fill values and the fill in the label.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { degrees, PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { recalculateAllMeasurements } = await import('../annotations/measurement.js');
const { measureKindType, MEASURE_EXTRA_KEY } = await import('../annotations/measure-extras.js');
const { createRacewayAnnotation } = await import('../tools/raceway/raceway-creator.js');

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);
const QUARTER_INCH = { pixelsPerUnit: 18, unit: 'ft' }; // 1/4" = 1'-0"

function openDocument(measureScale, annotations = []) {
  state.documents = [{ id: `rwf-rt-${Math.random()}`, filePath: 'C:/rwf/input.pdf', pdfDoc: {},
    currentPage: 1, annotations, measureScale, pageRotations: {}, _annotationPagesReady: new Set([1]),
    textEdits: [] }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function save(bytes, annotations, measureScale) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_p, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_p, data) => { saved = data; return true; },
  } };
  openDocument(measureScale, annotations);
  assert.equal(await savePDF('C:/rwf/output.pdf', { zonderHandtekeningVraag: true }), true);
  return saved;
}

async function reopen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const colors = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
    const models = [];
    for (const a of await page.getAnnotations()) {
      const m = await convertPdfAnnotation(a, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (m) models.push(m);
    }
    return models;
  } finally {
    await task.destroy();
  }
}

const PTS = [{ x: 60, y: 60 }, { x: 420, y: 60 }, { x: 420, y: 240 }];
const THHN = (count, size) => ({ count, size, insulation: 'THHN' });

test('a conduit run with conductors saves and reopens with its fill', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([792, 612]);
  page.setCropBox(20, 30, 760, 580);
  page.setRotation(degrees(90));
  const bytes = await source.save();
  openDocument(QUARTER_INCH);
  const over = createRacewayAnnotation(PTS, { kind: 'conduit', conduitType: 'EMT', tradeSize: '1/2',
    conductors: [THHN(9, '12'), THHN(1, '12')] }, 1);
  const ok = createRacewayAnnotation(PTS.map((p) => ({ x: p.x, y: p.y + 300 })), { kind: 'conduit',
    conduitType: 'EMT', tradeSize: '3/4', conductors: [THHN(3, '10'), { count: 1, size: '10', insulation: 'XHHW' }] }, 1);
  assert.match(over.measureText, / · ⚠ fill 44% > 40%$/u);
  assert.equal(over.measureFillOver, true);
  const saved = await save(bytes, [over, ok], QUARTER_INCH);
  const doc = await PDFDocument.load(saved);
  const extras = doc.context.lookup(doc.getPages()[0].node.get(PDFName.of('Annots'))).asArray()
    .map((r) => doc.context.lookup(r)).filter((d) => d.get(PDFName.of(MEASURE_EXTRA_KEY)));
  assert.equal(extras.length, 2);
  const runs = (await reopen(saved)).filter((m) => measureKindType(m) === 'measureRaceway');
  assert.equal(runs.length, 2);
  const a = runs.find((r) => r.raceway.tradeSize === '1/2');
  const b = runs.find((r) => r.raceway.tradeSize === '3/4');
  assert.deepEqual(a.raceway.conductors, [THHN(9, '12'), THHN(1, '12')]);
  assert.equal(a.measureFillOver, true);
  near(a.measureFillPercent, 0.133 / 0.304 * 100, 1e-9);
  assert.equal(a.measureFillLimit, 40);
  assert.match(a.measureText, /1\/2" EMT · 1 × 90° · Bends 90° · ⚠ fill 44% > 40%$/u);
  assert.deepEqual(b.raceway.conductors, [THHN(3, '10'), { count: 1, size: '10', insulation: 'XHHW' }]);
  near(b.measureFillPercent, (3 * 0.0211 + 0.0243) / 0.533 * 100, 1e-9);
  assert.equal(b.measureFillOver, undefined);
  assert.match(b.measureText, /Fill 16% \(≤40%\)$/u);
  // Recalculating after reopening gives the same fill.
  openDocument(QUARTER_INCH, runs);
  recalculateAllMeasurements();
  near(a.measureFillPercent, 0.133 / 0.304 * 100, 1e-9);
  assert.match(a.measureText, /⚠ fill 44% > 40%$/u);
});
