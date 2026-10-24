// Conduit and cable tray runs on real PDF bytes: created at 1/4" = 1'-0",
// saved by the real saver, reopened by PDF.js + the annotation converter —
// on a plain sheet and on one with /Rotate 90 and an offset CropBox.

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
const { racewayGeometry } = await import('../annotations/raceway.js');

const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b}`);
const QUARTER_INCH = { pixelsPerUnit: 18, unit: 'ft' }; // 1/4" = 1'-0"

function openDocument(measureScale, annotations = []) {
  state.documents = [{ id: `rw-rt-${Math.random()}`, filePath: 'C:/rw/input.pdf', pdfDoc: {},
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
  assert.equal(await savePDF('C:/rw/output.pdf', { zonderHandtekeningVraag: true }), true);
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

// A 3/4" EMT run: 20 ft east, 45° turn, 10 ft, 45° turn back to south... ending
// with a 90°: bends 90 + 45 + 45 = 180°.
const CONDUIT_PTS = [{ x: 60, y: 60 }, { x: 420, y: 60 }, { x: 420, y: 240 },
  { x: 420 + 127.28, y: 240 + 127.28 }, { x: 420 + 127.28, y: 500 }];
const LADDER_PTS = [{ x: 60, y: 300 }, { x: 330, y: 300 }, { x: 330, y: 480 }];
const BASKET_PTS = [{ x: 60, y: 540 }, { x: 330, y: 540 }];

function buildRuns() {
  const conduit = createRacewayAnnotation(CONDUIT_PTS, { kind: 'conduit', conduitType: 'EMT', tradeSize: '3/4' }, 1);
  const ladder = createRacewayAnnotation(LADDER_PTS, { kind: 'tray', trayStyle: 'ladder', widthIn: 24, railIn: 4 }, 1);
  const basket = createRacewayAnnotation(BASKET_PTS, { kind: 'tray', trayStyle: 'basket', widthIn: 12, railIn: 2 }, 1);
  return [conduit, ladder, basket];
}

function check(models, label) {
  const runs = models.filter((m) => measureKindType(m) === 'measureRaceway');
  assert.equal(runs.length, 3, `${label}: three runs reopen (${models.map((m) => m.type).join(', ')})`);
  const conduit = runs.find((r) => r.raceway.kind === 'conduit');
  const ladder = runs.find((r) => r.raceway.trayStyle === 'ladder');
  const basket = runs.find((r) => r.raceway.trayStyle === 'basket');
  assert.deepEqual(conduit.raceway, { kind: 'conduit', conduitType: 'EMT', tradeSize: '3/4', trueSize: false });
  assert.deepEqual(conduit.measureFittings, [{ angle: 90, count: 1 }, { angle: 45, count: 2 }]);
  near(conduit.measureBendTotal, 180, 0.01, 'bends');
  const expected = racewayGeometry(CONDUIT_PTS, conduit.raceway, 1.5).developedPx / 18;
  near(conduit.measureValue, expected, 0.01, `${label}: developed length ft`);
  assert.equal(conduit.measureUnit, 'ft');
  assert.match(conduit.measureText, /3\/4" EMT · 1 × 90°, 2 × 45° · Bends 180°$/u);
  assert.deepEqual(ladder.raceway, { kind: 'tray', trayStyle: 'ladder', widthIn: 24, railIn: 4, rungIn: 9 });
  assert.equal(basket.raceway.widthIn, 12);
  near(basket.measureValue, 15, 1e-6, '270 pt = 15 ft');
  // Corners come back in annotation space, whatever the page rotation.
  for (let i = 0; i < CONDUIT_PTS.length; i++) {
    near(conduit.points[i].x, CONDUIT_PTS[i].x, 0.01, `${label} x${i}`);
    near(conduit.points[i].y, CONDUIT_PTS[i].y, 0.01, `${label} y${i}`);
  }
  // Recalculating after reopening gives the same values.
  openDocument(QUARTER_INCH, runs);
  recalculateAllMeasurements();
  near(conduit.measureValue, expected, 0.01, `${label}: recalculated`);
  near(conduit.measurePxPerIn, 1.5, 1e-9);
}

for (const [label, setup] of [
  ['an unrotated sheet', (p) => p],
  ['a /Rotate 90 sheet with an offset CropBox', (p) => { p.setCropBox(20, 30, 760, 580); p.setRotation(degrees(90)); return p; }],
]) {
  test(`conduit, ladder and basket runs save and reopen on ${label}`, async () => {
    const source = await PDFDocument.create();
    setup(source.addPage([792, 612]));
    const bytes = await source.save();
    openDocument(QUARTER_INCH);
    const runs = buildRuns();
    const saved = await save(bytes, runs, QUARTER_INCH);
    // Other viewers get a vector appearance with the rails and rungs.
    const doc = await PDFDocument.load(saved);
    const annots = doc.context.lookup(doc.getPages()[0].node.get(PDFName.of('Annots'))).asArray()
      .map((r) => doc.context.lookup(r)).filter((d) => d.get(PDFName.of(MEASURE_EXTRA_KEY)));
    assert.equal(annots.length, 3);
    const strokes = annots.map((d) => {
      const ap = doc.context.lookup(doc.context.lookup(d.get(PDFName.of('AP'))).get(PDFName.of('N')));
      return (Buffer.from(ap.getContents()).toString('latin1').match(/ S\n|\nS\n/g) || []).length;
    }).sort((a, b) => a - b);
    assert.equal(strokes[0], 1, 'the conduit: one centre line');
    assert.ok(strokes[2] > 20, `the ladder tray: rails + rungs (${strokes[2]} strokes)`);
    check(await reopen(saved), label);
  });
}

test('without a calibration a run is symbolic and in page units', async () => {
  const source = await PDFDocument.create();
  source.addPage([792, 612]);
  openDocument(null);
  const run = createRacewayAnnotation(LADDER_PTS, { kind: 'tray', widthIn: 24 }, 1);
  assert.equal(run.measureUnit, 'pt');
  assert.equal(run.measurePxPerIn, undefined, 'no true width without a scale');
  near(run.measureValue, 270 + 180, 1e-9, 'sharp corners');
  assert.match(run.measureText, /^Scale not set · 450 pt · 24" Ladder tray/u);
  const models = await reopen(await save(await source.save(), [run], null));
  const back = models.find((m) => measureKindType(m) === 'measureRaceway');
  assert.equal(back.measureUnit, 'pt');
  assert.match(back.measureText, /^Scale not set/u);
});

test('pull boxes, a riser and the run tag survive save and reopen on a rotated cropped sheet', async () => {
  const source = await PDFDocument.create();
  const p = source.addPage([792, 612]);
  p.setCropBox(20, 30, 760, 580); p.setRotation(degrees(90));
  openDocument(QUARTER_INCH);
  const run = createRacewayAnnotation(CONDUIT_PTS, { kind: 'conduit', tradeSize: '1', marks: { 0: 'up', 2: 'pull' }, tag: 'F-3' }, 1);
  assert.deepEqual(run.measureBendSections.map(Math.round), [180, 45]);
  const saved = await save(await source.save(), [run], QUARTER_INCH);
  const back = (await reopen(saved)).find((m) => measureKindType(m) === 'measureRaceway');
  assert.deepEqual(back.raceway.marks, { 0: 'up', 2: 'pull' });
  assert.equal(back.raceway.tag, 'F-3');
  assert.deepEqual(back.measureBendSections.map(Math.round), [180, 45]);
  assert.match(back.measureText, /^F-3 · .*1" EMT · 1 × 90°, 1 × 45°, 1 × 90° up, 1 × pull box · Bends 180° \| 45°$/u);
});
