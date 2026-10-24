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
const { createAnnotation } = await import('../annotations/factory.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const { recalculateAllMeasurements } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { measureKindType, MEASURE_EXTRA_KEY } = await import('../annotations/measure-extras.js');
const { markupCsv } = await import('../annotations/markup-csv.js');
const {
  createPolylengthMeasurement, createVolumeMeasurement, createArcMeasurement, createRadius3Measurement, asMeasureKind,
} = await import('../tools/measure-extra-creators.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
// 1 pt = 100 mm.
const MM_100 = { pixelsPerUnit: 0.01, unit: 'mm' };

function openDocument(measureScale, annotations = []) {
  state.documents = [{ id: `extras-rt-${Math.random()}`, filePath: 'C:/extras/input.pdf', pdfDoc: {},
    currentPage: 1, annotations, measureScale, pageRotations: {}, _annotationPagesReady: new Set([1]),
    textEdits: [] }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureVolumeDepth = undefined;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function save(bytes, annotations, measureScale) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  openDocument(measureScale, annotations);
  assert.equal(await savePDF('C:/extras/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

async function rawExtras(bytes) {
  const doc = await PDFDocument.load(bytes);
  const context = doc.context;
  const array = context.lookup(doc.getPages()[0].node.get(PDFName.of('Annots')));
  return array.asArray().map(ref => context.lookup(ref))
    .filter(dict => dict.get(PDFName.of(MEASURE_EXTRA_KEY)))
    .map(dict => ({
      subtype: dict.get(PDFName.of('Subtype'))?.toString(),
      json: JSON.parse(decodePdfTextObject(dict.get(PDFName.of(MEASURE_EXTRA_KEY)))),
      appearance: dict.get(PDFName.of('AP')),
      dict, context,
    }));
}

async function reopen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const pdfLibDoc = await PDFDocument.load(bytes.slice());
    const colors = await extractAnnotationColors(1, pdfLibDoc);
    const models = [];
    for (const annotation of await page.getAnnotations()) {
      const model = await convertPdfAnnotation(annotation, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (model) models.push(model);
    }
    return models;
  } finally {
    await task.destroy();
  }
}

function byKind(models) {
  return Object.fromEntries(models.filter(m => m.type?.startsWith('measure')).map(m => [measureKindType(m), m]));
}

function buildModels() {
  const poly = createPolylengthMeasurement([{ x: 100, y: 100 }, { x: 130, y: 100 }, { x: 130, y: 140 }]);
  const vol = createVolumeMeasurement([{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }, { x: 200, y: 300 }]);
  vol.measureDepth = 0.3; vol.measureDepthUnit = 'm'; vol.measureShowCentroid = true;
  const arc = createArcMeasurement({ x: 100, y: 400 }, { x: 150, y: 350 }, { x: 200, y: 400 });
  const radius = createRadius3Measurement({ x: 440, y: 500 }, { x: 400, y: 540 }, { x: 360, y: 500 });
  const wall = asMeasureKind(createAnnotation({ type: 'measureDistance', page: 1,
    startX: 100, startY: 600, endX: 130, endY: 600 }), undefined, {
    measureDepth: 2400, measureDepthUnit: 'mm', measureSlopeMode: 'pitch', measureSlope: 12,
    measureCaption: ['length', 'wallArea', 'slope'] });
  return [poly, vol, arc, radius, wall];
}

function checkCalibrated(models) {
  const m = byKind(models);
  assert.ok(m.measurePolylength && m.measureVolume && m.measureArc && m.measureRadius && m.measureDistance,
    `all kinds reopen: ${Object.keys(m).join(', ')}`);
  close(m.measurePolylength.measureValue, 7000, 1e-3);
  assert.deepEqual(m.measurePolylength.measureSegmentTexts, ['3000 mm', '4000 mm']);
  assert.equal(m.measurePolylength.measureShowSegments, true);
  close(m.measureVolume.measureVolumeValue, 3e10, 1);
  assert.equal(m.measureVolume.measureVolumeUnit, 'mm³');
  assert.equal(m.measureVolume.measureDepth, 0.3);
  assert.equal(m.measureVolume.measureDepthUnit, 'm');
  assert.equal(m.measureVolume.measureShowCentroid, true);
  assert.equal(m.measureVolume.measureText, '30.00 m³');
  close(m.measureArc.measureValue, 5000 * Math.PI, 1e-3);
  assert.equal(m.measureArc.points.length, 33);
  close(m.measureRadius.measureValue, 4000, 1e-3);
  assert.equal(m.measureRadius.measureText, 'R 4000');
  const wall = m.measureDistance;
  close(wall.measureValue, 3000 * Math.SQRT2, 1e-3);
  close(wall.measureWallAreaValue, 3000 * Math.SQRT2 * 2400, 1);
  assert.deepEqual(wall.measureCaption, ['length', 'wallArea', 'slope']);
  assert.equal(wall.measureSlopeMode, 'pitch');
  assert.match(wall.measureText, /^4243 · Wall 10\.18 m² · Slope 12:12$/u);
}

test('polylength, volume, arc, radius and wall-area extras survive two PDF saves', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  openDocument(MM_100);
  const models = buildModels();
  openDocument(MM_100, models);
  recalculateAllMeasurements();
  const firstBytes = await save(await source.save(), models, MM_100);
  const raw = await rawExtras(firstBytes);
  assert.equal(raw.length, 5, 'each extras measurement carries one /OPS_MeasureExtra');
  assert.deepEqual(raw.map(r => r.subtype).sort(), ['/Line', '/Line', '/PolyLine', '/PolyLine', '/Polygon']);
  for (const r of raw) assert.ok(r.appearance, 'other viewers get an appearance');
  const polyAp = raw.find(r => r.json.kind === 'polylength');
  const apStream = polyAp.context.lookup(polyAp.context.lookup(polyAp.appearance).get(PDFName.of('N')));
  const apText = Buffer.from(apStream.getContents()).toString('latin1');
  assert.match(apText, /\(3000 mm\) Tj/u, 'segment values are in the appearance');
  assert.match(apText, /\(4000 mm\) Tj/u);

  const first = await reopen(firstBytes);
  checkCalibrated(first);
  // Reopened geometry gives the same values under the same scale.
  openDocument(MM_100, first);
  recalculateAllMeasurements();
  checkCalibrated(first);

  const secondBytes = await save(firstBytes, first, MM_100);
  assert.equal((await rawExtras(secondBytes)).length, 5, 'second save replaces, never duplicates');
  const second = await reopen(secondBytes);
  checkCalibrated(second);
  const csv = markupCsv(second);
  assert.match(csv, /"measureVolume".*"30\.00 m³","UNVERIFIED"/u);
  assert.match(csv, /"measurePolylength".*"7000 mm","UNVERIFIED"/u);
});

test('uncalibrated extras reopen in page units with the warning on a rotated page', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]).setRotation(degrees(90));
  openDocument(null);
  const poly = createPolylengthMeasurement([{ x: 100, y: 100 }, { x: 130, y: 100 }, { x: 130, y: 140 }]);
  const vol = createVolumeMeasurement([{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }]);
  vol.measureDepth = 2;
  openDocument(null, [poly, vol]);
  recalculateAllMeasurements();
  const bytes = await save(await source.save(), [poly, vol], null);
  const m = byKind(await reopen(bytes));
  assert.equal(m.measurePolylength.measureUnit, 'pt');
  assert.equal(m.measurePolylength.measureCalibrated, false);
  assert.match(m.measurePolylength.measureText, /^Scale not set · 70 pt$/u);
  assert.equal(m.measureVolume.measureVolumeUnit, 'pt³');
  assert.match(m.measureVolume.measureText, /^Scale not set · 10000 pt³$/u);
  close(m.measurePolylength.points[1].x, 130, 0.01);
  close(m.measurePolylength.points[2].y, 140, 0.01);
});
