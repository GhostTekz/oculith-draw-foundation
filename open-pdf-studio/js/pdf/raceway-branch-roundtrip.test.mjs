// Raceway branches (tees, crosses, reducers) on real PDF bytes: saved by the
// real saver, reopened by PDF.js + the annotation converter, on a /Rotate 90
// sheet with an offset CropBox.

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
const { racewayDrawing, branchJunction } = await import('../annotations/raceway.js');

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

// A 24" ladder main with a 12" branch either side at the same point (a
// cross) and a 12" branch further on (a tee + reducer), and a 3/4" EMT run
// with a 1/2" branch.
function buildRuns() {
  const runs = [];
  openDocument(QUARTER_INCH);
  const add = (id, pts, rw, branchOf) => {
    const a = createRacewayAnnotation(pts, { ...rw, ...(branchOf ? { branchOf } : {}) }, 1);
    a.id = id;
    runs.push(a);
    return a;
  };
  add('main', [{ x: 60, y: 200 }, { x: 600, y: 200 }], { kind: 'tray', trayStyle: 'ladder', widthIn: 24, railIn: 4 });
  add('crossA', [{ x: 240, y: 200 }, { x: 240, y: 420 }], { kind: 'tray', widthIn: 12 }, { id: 'main', at: { x: 240, y: 200 } });
  add('crossB', [{ x: 240, y: 200 }, { x: 240, y: 60 }], { kind: 'tray', widthIn: 12 }, { id: 'main', at: { x: 240, y: 200 } });
  add('tee', [{ x: 450, y: 200 }, { x: 450, y: 380 }, { x: 560, y: 380 }], { kind: 'tray', widthIn: 12 }, { id: 'main', at: { x: 450, y: 200 } });
  add('emt', [{ x: 60, y: 500 }, { x: 600, y: 500 }], { kind: 'conduit', tradeSize: '3/4' });
  add('emtTee', [{ x: 300, y: 500 }, { x: 300, y: 580 }], { kind: 'conduit', tradeSize: '1/2' }, { id: 'emt', at: { x: 300, y: 500 } });
  // The document's runs as a whole: each branch finds its parent there.
  openDocument(QUARTER_INCH, runs);
  recalculateAllMeasurements();
  return runs;
}

const FITTINGS = {
  main: [], crossA: ['cross', 'reducer'], crossB: ['reducer'], tee: [90, 'tee', 'reducer'],
  emt: [], emtTee: ['tee', 'reducer'],
};
const kinds = (a) => (a.measureFittings || []).map((f) => f.angle);

function strokesOf(doc, dict) {
  const ap = doc.context.lookup(doc.context.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  return (Buffer.from(ap.getContents()).toString('latin1').match(/ S\n|\nS\n/g) || []).length;
}
const strokeCount = (d) => d.lines.filter((l) => l.length >= 2).length + d.thin.filter((l) => l.length >= 2).length;

test('a main run with a cross, a tee and a conduit branch saves and reopens on a /Rotate 90 sheet with an offset CropBox', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([792, 612]);
  page.setCropBox(20, 30, 760, 580);
  page.setRotation(degrees(90));
  const bytes = await source.save();
  const runs = buildRuns();
  for (const r of runs) assert.deepEqual(kinds(r), FITTINGS[r.id], `${r.id} before saving`);
  assert.match(runs.find((r) => r.id === 'crossA').measureText, /12" Ladder tray, 4" rail · 1 × cross, 1 × reducer$/u);
  const expected = Object.fromEntries(runs.map((r) => [r.id,
    strokeCount(racewayDrawing(r.points, r.raceway, r.measurePxPerIn, branchJunction(r, runs)))]));
  const plainTee = racewayDrawing(runs[3].points, { ...runs[3].raceway, branchOf: undefined }, runs[3].measurePxPerIn);
  const teeDrawing = racewayDrawing(runs[3].points, runs[3].raceway, runs[3].measurePxPerIn, branchJunction(runs[3], runs));
  assert.equal(teeDrawing.lines.length, plainTee.lines.length + 2, 'the tee adds its two chamfers');

  const saved = await save(bytes, runs, QUARTER_INCH);
  // Other viewers: the appearance has the junction symbols.
  const doc = await PDFDocument.load(saved);
  const dicts = doc.context.lookup(doc.getPages()[0].node.get(PDFName.of('Annots'))).asArray()
    .map((r) => doc.context.lookup(r)).filter((d) => d.get(PDFName.of(MEASURE_EXTRA_KEY)));
  assert.equal(dicts.length, 6);
  for (const d of dicts) {
    const json = JSON.parse(doc.context.lookup(d.get(PDFName.of(MEASURE_EXTRA_KEY))).decodeText());
    assert.equal(strokesOf(doc, d), expected[json.rid], `${json.rid}: appearance strokes`);
  }

  const back = (await reopen(saved)).filter((m) => measureKindType(m) === 'measureRaceway');
  assert.equal(back.length, 6);
  const byId = Object.fromEntries(back.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), Object.keys(FITTINGS).sort(), 'run ids come back');
  assert.deepEqual(byId.crossB.raceway.branchOf, { id: 'main', at: { x: 240, y: 200 } });
  assert.deepEqual(byId.emtTee.raceway.branchOf, { id: 'emt', at: { x: 300, y: 500 } });
  for (const r of back) assert.deepEqual(kinds(r), FITTINGS[r.id], `${r.id} reopened`);
  for (const [id, x, y] of [['crossA', 240, 200], ['tee', 450, 200], ['emtTee', 300, 500]]) {
    near(byId[id].points[0].x, x, 0.01, `${id} start x`);
    near(byId[id].points[0].y, y, 0.01, `${id} start y`);
  }
  // Recalculated after reopening: the same junctions.
  openDocument(QUARTER_INCH, back);
  recalculateAllMeasurements();
  for (const r of back) assert.deepEqual(kinds(r), FITTINGS[r.id], `${r.id} recalculated`);
  assert.equal(branchJunction(byId.crossA, back).fitting, 'cross');
  assert.equal(branchJunction(byId.tee, back).fitting, 'tee');
  assert.equal(branchJunction(byId.emtTee, back).fitting, 'tee');

  // Deleting the main run: its branches become plain runs.
  const rest = back.filter((r) => r.id !== 'main');
  openDocument(QUARTER_INCH, rest);
  recalculateAllMeasurements();
  for (const id of ['crossA', 'crossB']) assert.deepEqual(kinds(byId[id]), [], `${id} without its parent`);
  assert.deepEqual(kinds(byId.tee), [90]);
  const again = await save(await source.save(), rest, QUARTER_INCH);
  assert.equal((await reopen(again)).filter((m) => measureKindType(m) === 'measureRaceway').length, 5);
});
