// An uncalibrated 3-point radius and arc length stay in page units, with the
// warning, on a rotated CropBox page, beside a scale region, through two
// saves. A schedule format must not relabel that page-point column as feet.
// The length inside the region still uses the region's physical unit.

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
const { recalculateAllMeasurements, getMeasureScale } = await import('../annotations/measurement.js');
const { createScaleRegion, invalidateScaleRegionCache, pixelsPerUnitFor } = await import('../annotations/scale-region.js');
const { createArcMeasurement, createRadius3Measurement } = await import('../tools/measure-extra-creators.js');
const nv = await import('../annotations/named-viewports.js');
const { readPdfMarkups, fileSummaryRows } = await import('../batch/summary-read.js');
const { combineSummaries, summaryCsv, summaryXlsx, summaryPdf, totalsOf, totalsText } = await import('../batch/summary-output.js');
const { buildSchedule } = await import('../quantities/engine.js');
const { scheduleResultToCsv } = await import('../quantities/schedule-csv.js');
const { unzip } = await import('../bcf/bcf-zip.js');

const fontBytes = new Uint8Array(await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url)));
const PHYSICAL = /\b(?:ft|feet|metre|meter|metres|meters|mm|millimetre|millimeter|millimetres|millimeters|cm|in|inch|inches)\b|m²|m³|ft²|ft³|['′]/iu;

function openDocument(annotations = []) {
  state.documents = [{
    id: `acc03-${Math.random()}`, filePath: 'C:/acc03/input.pdf', pdfDoc: { numPages: 1 },
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
  assert.equal(await savePDF('C:/acc03/output.pdf', { zonderHandtekeningVraag: true }), true);
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

function assertPageUnits(text) {
  assert.match(text, /Scale not set/u);
  assert.match(text, /\d+(?:\.\d+)? pt\b/u);
  assert.doesNotMatch(text, PHYSICAL);
}

function close(actual, expected, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
}

function checkLive(doc) {
  const region = doc.annotations.find((ann) => ann.type === 'scaleRegion' && ann.label === 'Sheet feet');
  assert.ok(region, 'the scale region reopened');
  assert.equal(region.units, 'ft');
  assert.equal(region.scaleString, '1:48');

  const inside = getMeasureScale(1, 96, 100);
  assert.equal(inside.unit, 'ft');
  assert.equal(inside.calibrated, true);
  assert.equal(inside.source, 'scaleRegion');
  assert.equal(inside.pixelsPerUnit, pixelsPerUnitFor(region.scaleString, region.units));
  const outside = getMeasureScale(1, 400, 460);
  assert.equal(outside.unit, 'pt');
  assert.equal(outside.calibrated, false);

  const radius = bySubject(doc, 'Uncalibrated radius');
  assert.equal(radius.type, 'measureDistance');
  assert.equal(radius.measureKind, 'radius');
  assert.equal(radius.measureScale ?? null, null, 'the radius has no scale of its own');
  assert.equal(radius.measureCalibrated, false);
  assert.equal(radius.measureUnit, 'pt');
  assertPageUnits(radius.measureText);
  assert.match(radius.measureText, /R \d+(?:\.\d+)? pt/u);
  close(radius.measureValue, 40, 0.05);
  const radiusScale = getMeasureScale(1, (radius.startX + radius.endX) / 2, (radius.startY + radius.endY) / 2);
  assert.equal(radiusScale.calibrated, false);
  assert.equal(radiusScale.unit, 'pt');

  const arc = bySubject(doc, 'Uncalibrated arc');
  assert.equal(arc.type, 'measurePerimeter');
  assert.equal(arc.measureKind, 'arc');
  assert.equal(arc.measureScale ?? null, null, 'the arc has no scale of its own');
  assert.ok(Array.isArray(arc.points) && arc.points.length >= 3, 'the arc keeps its flattened points');
  assert.equal(arc.measureCalibrated, false);
  assert.equal(arc.measureUnit, 'pt');
  assertPageUnits(arc.measureText);
  close(arc.measureValue, 60 * Math.PI, 0.05);
  const cx = arc.points.reduce((sum, point) => sum + point.x, 0) / arc.points.length;
  const cy = arc.points.reduce((sum, point) => sum + point.y, 0) / arc.points.length;
  const arcScale = getMeasureScale(arc.page || 1, cx, cy);
  assert.equal(arcScale.calibrated, false);
  assert.equal(arcScale.unit, 'pt');

  const length = bySubject(doc, 'Region length');
  assert.equal(length.measureUnit, 'ft');
  assert.notEqual(length.measureCalibrated, false);
  assert.doesNotMatch(length.measureText, /Scale not set/u);
  assert.match(length.measureText, /'|ft/u);
  close(length.measureValue, 4, 0.05);

  // A saved schedule format may rename a calibrated unit. It must not turn
  // these page-point numbers into feet.
  const schedule = buildSchedule([radius, arc], {
    categories: ['line-based'],
    fields: ['label', 'length'],
    format: { length: { unit: 'ft' } },
  });
  const column = schedule.columns.find((col) => col.key === 'length');
  assert.equal(column.unit, 'pt');
  const rows = schedule.groups.flatMap((group) => group.rows);
  const radiusRow = rows.find((row) => row.vals.label === 'Uncalibrated radius');
  const arcRow = rows.find((row) => row.vals.label === 'Uncalibrated arc');
  assert.ok(radiusRow && arcRow, 'schedule rows for the radius and the arc');
  assert.equal(radiusRow.units.length, 'pt');
  assert.equal(arcRow.units.length, 'pt');
  close(radiusRow.vals.length, radius.measureValue);
  close(arcRow.vals.length, arc.measureValue);
  close(schedule.grandTotals.length, radius.measureValue + arc.measureValue);
  const takeoff = scheduleResultToCsv(schedule);
  assert.match(takeoff, /Length \(pt\)/u);
  assert.match(takeoff, new RegExp(radius.measureValue.toFixed(2)));
  assert.match(takeoff, new RegExp(arc.measureValue.toFixed(2)));
  assert.match(takeoff, new RegExp(`${schedule.grandTotals.length.toFixed(2)} pt`));
  assert.doesNotMatch(takeoff, PHYSICAL);
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
  const radius = rows.find((row) => row.subject === 'Uncalibrated radius');
  const arc = rows.find((row) => row.subject === 'Uncalibrated arc');
  const length = rows.find((row) => row.subject === 'Region length');
  assert.ok(radius && arc && length, 'summary rows for the radius, the arc and the region length');
  assert.equal(radius.type, 'measureRadius');
  assert.equal(radius.calibrated, false);
  assert.equal(radius.value, null);
  assert.equal(radius.unit, '');
  assertPageUnits(radius.measurement);
  assert.equal(arc.type, 'measureArc');
  assert.equal(arc.calibrated, false);
  assert.equal(arc.value, null);
  assert.equal(arc.unit, '');
  assertPageUnits(arc.measurement);
  assert.equal(length.calibrated, true);
  assert.equal(length.unit, 'ft');
  assert.doesNotMatch(length.measurement, /Scale not set/u);

  const totals = totalsOf(rows);
  assert.equal(totals.uncalibrated, 2);
  assert.ok(totals.sums.some((sum) => sum.unit === 'ft'));
  assert.equal(totals.sums.some((sum) => /^pt/u.test(sum.unit)), false);
  assert.match(totalsText(totals), /Scale not set: 2/u);

  const summary = combineSummaries(
    [{ file: { name: 'rotated-crop.pdf', path: 'rotated-crop.pdf' }, rows }],
    { log: [{ name: 'rotated-crop.pdf', path: 'rotated-crop.pdf', ok: true }], generatedAt: new Date('2026-10-18T00:00:00.000Z') },
  );
  const csv = summaryCsv(summary);
  assert.ok(csv.includes(radius.measurement));
  assert.ok(csv.includes(arc.measurement));
  const sheets = await unzip(summaryXlsx(summary));
  const xlsx = [...sheets.values()].map((part) => new TextDecoder().decode(part)).join('\n');
  assert.ok(xlsx.includes(radius.measurement), 'xlsx keeps the uncalibrated radius text');
  assert.ok(xlsx.includes(arc.measurement), 'xlsx keeps the uncalibrated arc text');
  assert.ok(xlsx.includes('Scale not set: 2'), 'xlsx totals count the uncalibrated rows');
  const drawn = await pdfText(await summaryPdf(summary, fontBytes));
  assert.match(drawn, /Scale not set/u);
  assert.match(drawn, /Uncalibrated radius/u);
  assert.match(drawn, /Uncalibrated arc/u);
}

function buildSheet() {
  const doc = openDocument();
  doc.annotations.push(createScaleRegion({
    page: 1, x: 40, y: 40, width: 180, height: 140, scaleString: '1:48', units: 'ft', label: 'Sheet feet',
  }));
  const radius = createRadius3Measurement({ x: 460, y: 460 }, { x: 420, y: 500 }, { x: 380, y: 460 });
  radius.subject = 'Uncalibrated radius';
  const arc = createArcMeasurement({ x: 300, y: 300 }, { x: 360, y: 360 }, { x: 420, y: 300 });
  arc.subject = 'Uncalibrated arc';
  const length = createAnnotation({
    type: 'measureDistance', page: 1, startX: 60, startY: 100, endX: 132, endY: 100, subject: 'Region length',
  });
  doc.annotations.push(radius, arc, length);
  invalidateScaleRegionCache();
  recalculateAllMeasurements();
  return doc;
}

test('uncalibrated radius and arc stay in page units beside a scale region through two saves', async () => {
  const doc = buildSheet();
  checkLive(doc);
  let bytes = await save(await blankPage());
  await checkSummary(bytes);
  const first = await reopen(bytes);
  checkLive(first);
  recalculateAllMeasurements();
  checkLive(first);
  bytes = await save(bytes);
  await checkSummary(bytes);
  const second = await reopen(bytes);
  checkLive(second);
  recalculateAllMeasurements();
  checkLive(second);
});
