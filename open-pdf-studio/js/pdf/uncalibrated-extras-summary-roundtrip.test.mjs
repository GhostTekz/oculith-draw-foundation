// K-004: an uncalibrated volume and wall area stay in page units, with the
// warning, on a rotated CropBox page, beside a nested scale region, through
// two saves and the CSV / XLSX / PDF summary. A schedule format must not
// relabel that page-point column as metres or feet.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import { degrees, PDFDocument } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { createAnnotation } = await import('../annotations/factory.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { leesPdfViewports } = await import('./pdf-viewports.js');
const { leesEigenViewports } = await import('./viewports-vp.js');
const { recalculateAllMeasurements, getMeasureScale, formatMeasurement } = await import('../annotations/measurement.js');
const { createScaleRegion, invalidateScaleRegionCache, pixelsPerUnitFor } = await import('../annotations/scale-region.js');
const { createVolumeMeasurement, asMeasureKind } = await import('../tools/measure-extra-creators.js');
const nv = await import('../annotations/named-viewports.js');
const { readPdfMarkups, fileSummaryRows } = await import('../batch/summary-read.js');
const { combineSummaries, summaryCsv, summaryXlsx, summaryPdf, totalsOf, totalsText } = await import('../batch/summary-output.js');
const { measurementLegend, legendTotalText } = await import('../quantities/measurement-legend.js');
const { buildSchedule } = await import('../quantities/engine.js');
const { scheduleResultToCsv } = await import('../quantities/schedule-csv.js');
const { unzip } = await import('../bcf/bcf-zip.js');

const fontBytes = new Uint8Array(await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url)));
const PHYSICAL = /(?:^|[^A-Za-z])(?:ft|feet|metre|meter|metres|meters|mm|cm|in)(?:[^A-Za-z]|$)|m²|m³|ft²|ft³|mm²|mm³|cm²|in²/u;

function openDocument(annotations = []) {
  state.documents = [{
    id: `k004-${Math.random()}`, filePath: 'C:/k004/input.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, annotations, measureScale: null, pageRotations: {}, pageScales: {},
    _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.preferences.measureVolumeDepth = undefined;
  state.preferences.measureVolumeDepthUnit = undefined;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function blankPage() {
  const src = await PDFDocument.create();
  const page = src.addPage([800, 600]);
  page.setCropBox(100, 50, 600, 500);
  page.setRotation(degrees(90));
  return src.save();
}

async function save(bytes) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/k004/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

async function reopen(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const lib = await PDFDocument.load(bytes.slice());
    const colors = await extractAnnotationColors(1, lib);
    const models = [];
    for (const annotation of await page.getAnnotations()) {
      const model = await convertPdfAnnotation(annotation, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (model) models.push(model);
    }
    const doc = openDocument(models);
    doc.pdfViewports = leesPdfViewports(lib);
    doc._eigenViewportsGelezen = false;
    nv.neemEigenViewportsOver(doc, leesEigenViewports(lib));
    invalidateScaleRegionCache();
    return doc;
  } finally {
    await task.destroy();
  }
}

function bySubject(doc, subject) {
  const found = doc.annotations.find((ann) => ann.subject === subject);
  assert.ok(found, `missing ${subject}`);
  return found;
}

function assertPageUnits(text, cubedOrSquared) {
  assert.match(text, /Scale not set/u);
  assert.match(text, new RegExp(`pt${cubedOrSquared}`));
  assert.doesNotMatch(text, PHYSICAL);
}

function checkLive(doc) {
  const outer = doc.annotations.find((ann) => ann.type === 'scaleRegion' && ann.label === 'Outer millimetres');
  const inner = doc.annotations.find((ann) => ann.type === 'scaleRegion' && ann.label === 'Inner feet');
  assert.ok(outer && inner, 'both scale regions reopened');
  assert.equal(outer.units, 'mm');
  assert.equal(inner.units, 'ft');
  assert.ok(inner.width * inner.height < outer.width * outer.height);

  const innerScale = getMeasureScale(1, 98, 110);
  assert.equal(innerScale.unit, 'ft');
  assert.equal(innerScale.calibrated, true);
  assert.equal(innerScale.source, 'scaleRegion');
  assert.equal(innerScale.pixelsPerUnit, pixelsPerUnitFor(inner.scaleString, inner.units));
  const outerScale = getMeasureScale(1, 86, 200);
  assert.equal(outerScale.unit, 'mm');
  assert.equal(outerScale.calibrated, true);
  assert.equal(outerScale.pixelsPerUnit, pixelsPerUnitFor(outer.scaleString, outer.units));
  const outside = getMeasureScale(1, 360, 420);
  assert.equal(outside.unit, 'pt');
  assert.equal(outside.calibrated, false);

  const volume = bySubject(doc, 'Uncalibrated volume');
  assert.equal(volume.measureCalibrated, false);
  assert.equal(volume.measureUnit, 'pt²');
  assert.equal(volume.measureVolumeUnit, 'pt³');
  assert.equal(volume.measureDepthUnit, 'pt');
  assertPageUnits(volume.measureText, '³');
  assert.ok(volume.measureVolumeValue > 0 && volume.measureVolumeValue < 100000);

  const wall = bySubject(doc, 'Uncalibrated wall');
  assert.equal(wall.measureCalibrated, false);
  assert.equal(wall.measureUnit, 'pt');
  assert.equal(wall.measureWallAreaUnit, 'pt²');
  assert.equal(wall.measureDepthUnit, 'pt');
  assertPageUnits(wall.measureText, '');
  assert.match(wall.measureText, /Wall \d+(?:\.\d+)? pt²/u);

  const feet = bySubject(doc, 'Inner feet');
  assert.equal(feet.measureUnit, 'ft');
  assert.doesNotMatch(feet.measureText, /Scale not set/u);
  assert.doesNotMatch(feet.measureText, /mm/u);
  const millimetres = bySubject(doc, 'Outer millimetres');
  assert.equal(millimetres.measureUnit, 'mm');
  assert.doesNotMatch(millimetres.measureText, /Scale not set/u);
  assert.doesNotMatch(millimetres.measureText, /ft/u);

  const legend = measurementLegend(doc.annotations, { page: 1 });
  const volumeRow = legend.find((row) => row.type === 'measureVolume' && row.subject === 'Uncalibrated volume');
  assert.ok(volumeRow?.total, 'the volume legend row has a total');
  assert.equal(volumeRow.total.calibrated, false);
  assert.equal(volumeRow.total.unit, 'pt³');
  assertPageUnits(legendTotalText(volumeRow, formatMeasurement), '³');
  const wallRow = legend.find((row) => row.type === 'measureDistance' && row.subject === 'Uncalibrated wall');
  assert.equal(wallRow?.total?.calibrated, false);
  assert.equal(wallRow.total.unit, 'pt');
  assertPageUnits(legendTotalText(wallRow, formatMeasurement), '');

  // A saved schedule format may rename a calibrated unit. It must not turn
  // these page-point numbers into metres or feet.
  const schedule = buildSchedule([volume, wall], {
    categories: ['area', 'line-based'],
    fields: ['label', 'area', 'length'],
    format: { area: { unit: 'm²' }, length: { unit: 'ft' } },
  });
  const column = (key) => schedule.columns.find((col) => col.key === key);
  assert.equal(column('area').unit, 'pt²');
  assert.equal(column('length').unit, 'pt');
  const takeoff = scheduleResultToCsv(schedule);
  assert.match(takeoff, /Area \(pt²\)/u);
  assert.match(takeoff, /Length \(pt\)/u);
  assert.doesNotMatch(takeoff, /m²|\(ft\)/u);
}

async function summaryRows(bytes) {
  const previousDocuments = state.documents;
  const previousIndex = state.activeDocumentIndex;
  const previousScale = state.preferences.measureScale;
  try {
    // A different open drawing must not lend its scale to this file.
    state.preferences.measureScale = { pixelsPerUnit: 72, unit: 'm' };
    state.documents = [{
      id: 'hostile', filePath: 'C:/other.pdf', pdfDoc: { numPages: 1 }, currentPage: 1,
      annotations: [], measureScale: { pixelsPerUnit: 18, unit: 'ft' },
      pageScales: { 1: { pixelsPerUnit: 18, unit: 'ft', method: 'ratio' } },
      _annotationPagesReady: new Set([1]), textEdits: [],
    }];
    state.activeDocumentIndex = 0;
    return fileSummaryRows(await readPdfMarkups(bytes, { pdfjs }), { file: 'rotated-crop.pdf' });
  } finally {
    state.documents = previousDocuments;
    state.activeDocumentIndex = previousIndex;
    state.preferences.measureScale = previousScale;
  }
}

async function pdfText(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    let text = '';
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const content = await (await pdf.getPage(pageNum)).getTextContent();
      text += `${content.items.map((item) => item.str).join(' ')}\n`;
    }
    return text;
  } finally {
    await task.destroy();
  }
}

async function checkSummary(bytes) {
  const lib = await PDFDocument.load(bytes.slice());
  const page = lib.getPages()[0];
  assert.equal(page.getRotation().angle, 90);
  const crop = page.getCropBox();
  assert.notEqual(crop.x, 0);
  assert.notEqual(crop.y, 0);

  const rows = await summaryRows(bytes);
  const volume = rows.find((row) => row.subject === 'Uncalibrated volume');
  const wall = rows.find((row) => row.subject === 'Uncalibrated wall');
  const feet = rows.find((row) => row.subject === 'Inner feet');
  assert.ok(volume && wall && feet, 'summary rows for the volume, the wall and the inner distance');
  assert.equal(volume.type, 'measureVolume');
  assert.equal(volume.calibrated, false);
  assert.equal(volume.value, null);
  assert.equal(volume.unit, '');
  assertPageUnits(volume.measurement, '³');
  assert.equal(wall.calibrated, false);
  assert.equal(wall.value, null);
  assert.equal(wall.unit, '');
  assertPageUnits(wall.measurement, '');
  assert.match(wall.measurement, /pt²/u);
  assert.equal(feet.calibrated, true);
  assert.equal(feet.unit, 'ft');
  assert.doesNotMatch(feet.measurement, /Scale not set/u);
  assert.equal(rows.find((row) => row.subject === 'Outer millimetres').unit, 'mm');

  const totals = totalsOf(rows);
  assert.equal(totals.uncalibrated, 2);
  assert.ok(totals.sums.some((sum) => sum.unit === 'ft'));
  assert.ok(totals.sums.some((sum) => sum.unit === 'mm'));
  assert.equal(totals.sums.some((sum) => /^pt/u.test(sum.unit)), false);
  assert.match(totalsText(totals), /Scale not set: 2/u);

  const summary = combineSummaries(
    [{ file: { name: 'rotated-crop.pdf', path: 'rotated-crop.pdf' }, rows }],
    { log: [{ name: 'rotated-crop.pdf', path: 'rotated-crop.pdf', ok: true }], generatedAt: new Date('2026-10-18T00:00:00.000Z') },
  );
  const csv = summaryCsv(summary);
  assert.ok(csv.includes(volume.measurement));
  assert.ok(csv.includes(wall.measurement));
  assert.match(csv, /"Scale not set · 3200 pt³","","/u);
  const sheets = await unzip(summaryXlsx(summary));
  const xlsx = [...sheets.values()].map((part) => new TextDecoder().decode(part)).join('\n');
  assert.ok(xlsx.includes(volume.measurement), 'xlsx keeps the uncalibrated volume text');
  assert.ok(xlsx.includes('Scale not set: 2'), 'xlsx totals count the uncalibrated rows');
  assert.ok(xlsx.includes(volume.subject));
  const drawn = await pdfText(await summaryPdf(summary, fontBytes));
  assert.match(drawn, /Scale not set/u);
  assert.match(drawn, /Uncalibrated volume/u);
}

function buildSheet() {
  const doc = openDocument();
  doc.annotations.push(
    createScaleRegion({ page: 1, x: 40, y: 40, width: 220, height: 220, scaleString: '1:100', units: 'mm', label: 'Outer millimetres' }),
    createScaleRegion({ page: 1, x: 70, y: 70, width: 80, height: 80, scaleString: '1:10', units: 'ft', label: 'Inner feet' }),
  );
  const volume = createVolumeMeasurement([
    { x: 340, y: 400 }, { x: 380, y: 400 }, { x: 380, y: 440 }, { x: 340, y: 440 },
  ]);
  volume.measureDepth = 2;
  volume.measureDepthUnit = 'pt';
  volume.subject = 'Uncalibrated volume';
  const wall = asMeasureKind(createAnnotation({
    type: 'measureDistance', page: 1, startX: 340, startY: 520, endX: 420, endY: 520,
  }), undefined, { measureDepth: 4, measureDepthUnit: 'pt' });
  wall.subject = 'Uncalibrated wall';
  const feet = createAnnotation({
    type: 'measureDistance', page: 1, startX: 80, startY: 110, endX: 116, endY: 110, subject: 'Inner feet',
  });
  const millimetres = createAnnotation({
    type: 'measureDistance', page: 1, startX: 50, startY: 200, endX: 122, endY: 200, subject: 'Outer millimetres',
  });
  doc.annotations.push(volume, wall, feet, millimetres);
  invalidateScaleRegionCache();
  recalculateAllMeasurements();
  return doc;
}

test('uncalibrated volume and wall area stay in page units beside a nested scale through two saves', async () => {
  const doc = buildSheet();
  checkLive(doc);
  let bytes = await save(await blankPage());
  await checkSummary(bytes);
  const first = await reopen(bytes);
  recalculateAllMeasurements();
  checkLive(first);
  bytes = await save(bytes);
  await checkSummary(bytes);
  const second = await reopen(bytes);
  recalculateAllMeasurements();
  checkLive(second);
});

test('a calibrated area may still be renamed by the schedule format', () => {
  const schedule = buildSchedule(
    [{ type: 'measureArea', page: 1, measureValue: 20_000_000, measureUnit: 'mm²' }],
    { categories: ['area'], fields: ['area'], format: { area: { unit: 'vierkante meter' } } },
  );
  assert.equal(schedule.columns.find((col) => col.key === 'area').unit, 'vierkante meter');
});
