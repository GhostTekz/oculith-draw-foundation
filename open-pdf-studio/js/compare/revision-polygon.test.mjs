import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCompareChangeReportModel } from './change-report.js';
import { pageViewOutlineToPdfRing } from './revision-geometry.js';
import { buildRevisionPolygonPdf } from './revision-markup-pdf.js';

async function rotatedCropFixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.setCropBox(50, 70, 300, 400);
  page.setRotation(degrees(90));
  return pdf.save();
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} vs ${expected}`);
}

function reportFor(outline) {
  const xs = outline.map(point => point.x);
  const ys = outline.map(point => point.y);
  const report = createCompareChangeReportModel({
    oldPath: 'issued.pdf', newPath: 'revised.pdf', oldPage: 2, newPage: 1,
    pairing: { source: 'manual', oldPage: 2, newPage: 1, confirmedAt: '2026-10-13T19:00:00.000Z' },
    offset: { dx: 1, dy: -2, rotation: 0 },
    changes: [{
      type: 'modified',
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      detectScale: 1,
    }],
  });
  return report;
}

function noisyOutline() {
  const left = 40;
  const top = 36;
  const right = 180;
  const bottom = 150;
  const steps = 6;
  const points = [];
  const jitter = index => ((index % 5) - 2) * 0.35;
  for (let index = 0; index <= steps; index++) {
    points.push({ x: left + ((right - left) * index) / steps, y: top + jitter(index) });
  }
  for (let index = 1; index <= steps; index++) {
    points.push({ x: right + jitter(index + 1), y: top + ((bottom - top) * index) / steps });
  }
  for (let index = 1; index <= steps; index++) {
    points.push({ x: right - ((right - left) * index) / steps, y: bottom + jitter(index + 2) });
  }
  for (let index = 1; index < steps; index++) {
    points.push({ x: left + jitter(index + 3), y: bottom - ((bottom - top) * index) / steps });
  }
  return points;
}

async function openPage(bytes) {
  const loading = getDocument({ data: bytes.slice(), useSystemFonts: false });
  const page = await (await loading.promise).getPage(1);
  return { loading, page };
}

function assertPolygon(annotation, ring) {
  assert.equal(annotation.subtype, 'Polygon');
  assert.equal(annotation.annotationFlags & (64 | 128), 0);
  assert.equal(annotation.annotationFlags & 4, 4);
  const flat = ring.flatMap(point => [point[0], point[1]]);
  assert.equal(annotation.vertices?.length, flat.length);
  for (let index = 0; index < flat.length; index++) near(annotation.vertices[index], flat[index], `vertex ${index}`);
}

test('a noisy page-view outline is simplified once into an editable PDF polygon', async () => {
  const source = await rotatedCropFixture();
  const opened = await openPage(source);
  const rectangle = [[120, 140], [220, 140], [220, 240], [120, 240]];
  const calls = [];
  let result;
  try {
    const outline = noisyOutline();
    const viewport = opened.page.getViewport({ scale: 1 });
    assert.ok(outline.length > 4);
    assert.ok(outline.every(point => point.x > 0 && point.y > 0 && point.x < viewport.width && point.y < viewport.height));
    const mapped = pageViewOutlineToPdfRing(opened.page, outline);
    const report = reportFor(outline);
    const invoke = (command, args) => {
      calls.push({ command, args });
      return rectangle;
    };
    result = await buildRevisionPolygonPdf({
      newBytes: source, report, change: report.changes[0], pdfPage: opened.page,
      targetPath: report.newPath, markupId: 'revision-outline-1', points: outline, invoke,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'geos_simplify');
    assert.equal(calls[0].args.tolerance, 0.75);
    assert.equal(calls[0].args.closed, true);
    assert.deepEqual(calls[0].args.points, mapped.ring);
    assert.notDeepEqual(calls[0].args.points, outline.map(point => [point.x, point.y]));
  } finally {
    await opened.loading.destroy();
  }
  const reopened = getDocument({ data: result.bytes.slice(), useSystemFonts: false });
  try {
    const page = await (await reopened.promise).getPage(1);
    const polygons = (await page.getAnnotations()).filter(item => item.subtype === 'Polygon');
    assert.equal(polygons.length, 1);
    assertPolygon(polygons[0], rectangle);
    assert.equal(polygons[0].contentsObj.str, result.content);
    assert.match(result.content, /UNREVIEWED OcuDraw comparison difference/u);
    assert.match(result.content, /Change: 1 \(modified, visual\)/u);
    assert.match(result.content, /Region within visible new page/u);
  } finally {
    await reopened.destroy();
  }
  const saved = await PDFDocument.load(result.bytes);
  const dict = saved.context.lookup(saved.getPage(0).node.lookup(PDFName.of('Annots')).asArray()[0]);
  assert.equal(String(dict.get(PDFName.of('Subtype'))), '/Polygon');
  assert.equal(dict.get(PDFName.of('NM')).decodeText(), 'revision-outline-1');
});

test('a failing geometry invoke still writes the mapped polygon ring', async () => {
  const source = await rotatedCropFixture();
  const opened = await openPage(source);
  const square = [[30, 40], [110, 40], [110, 120], [30, 120]];
  let result;
  let mapped;
  try {
    mapped = pageViewOutlineToPdfRing(opened.page, square);
    const outline = square.map(([x, y]) => ({ x, y }));
    const report = reportFor(outline);
    let calls = 0;
    const invoke = () => {
      calls += 1;
      throw new Error('geometry engine is not linked');
    };
    result = await buildRevisionPolygonPdf({
      newBytes: source, report, change: report.changes[0], pdfPage: opened.page,
      targetPath: report.newPath, markupId: 'revision-outline-throw', points: square, invoke,
    });
    assert.equal(calls, 1);
  } finally {
    await opened.loading.destroy();
  }
  const reopened = getDocument({ data: result.bytes.slice(), useSystemFonts: false });
  try {
    const page = await (await reopened.promise).getPage(1);
    const [polygon] = (await page.getAnnotations()).filter(item => item.subtype === 'Polygon');
    assertPolygon(polygon, mapped.ring);
  } finally {
    await reopened.destroy();
  }
});

test('a missing geometry invoke still writes the mapped polygon ring', async () => {
  const source = await rotatedCropFixture();
  const opened = await openPage(source);
  const square = [[36, 48], [100, 48], [100, 128], [36, 128]];
  let result;
  let mapped;
  try {
    mapped = pageViewOutlineToPdfRing(opened.page, square);
    const outline = square.map(([x, y]) => ({ x, y }));
    const report = reportFor(outline);
    result = await buildRevisionPolygonPdf({
      newBytes: source, report, change: report.changes[0], pdfPage: opened.page,
      targetPath: report.newPath, markupId: 'revision-outline-plain', points: square,
    });
  } finally {
    await opened.loading.destroy();
  }
  const reopened = getDocument({ data: result.bytes.slice(), useSystemFonts: false });
  try {
    const page = await (await reopened.promise).getPage(1);
    const [polygon] = (await page.getAnnotations()).filter(item => item.subtype === 'Polygon');
    assertPolygon(polygon, mapped.ring);
    assert.equal(polygon.annotationFlags & (64 | 128), 0);
  } finally {
    await reopened.destroy();
  }
});

test('a rotated crop box maps a page-view square with convertToPdfPoint', async () => {
  const source = await rotatedCropFixture();
  const opened = await openPage(source);
  try {
    const page = opened.page;
    assert.equal(page.rotate, 90);
    assert.ok(page.view[0] !== 0 || page.view[1] !== 0);
    const viewport = page.getViewport({ scale: 1 });
    const square = [
      { x: 30, y: 40 },
      { x: 110, y: 40 },
      { x: 110, y: 120 },
      { x: 30, y: 120 },
    ];
    const mapped = pageViewOutlineToPdfRing(page, square);
    const expected = square.map(point => viewport.convertToPdfPoint(point.x, point.y));
    assert.equal(mapped.clippedToPage, false);
    assert.deepEqual(mapped.ring, expected);
    const naive = square.map(point => [page.view[0] + point.x, page.view[3] - point.y]);
    assert.notDeepEqual(mapped.ring, naive);

    assert.throws(() => pageViewOutlineToPdfRing(page, [[1, 2], [3, 4]]), /three/u);
    assert.throws(() => pageViewOutlineToPdfRing(page, [[10, 12], [20, Number.NaN], [30, 40]]), /Finite/u);
    assert.throws(() => pageViewOutlineToPdfRing(page, [[-40, -20], [-30, -10], [-20, -30]]), /outside/u);
    const clipped = pageViewOutlineToPdfRing(page, [[-8, 40], [80, 40], [80, 90], [-8, 90]]);
    assert.equal(clipped.clippedToPage, true);
    assert.deepEqual(clipped.ring[0], viewport.convertToPdfPoint(0, 40));
    assert.deepEqual(clipped.ring[1], viewport.convertToPdfPoint(80, 40));
  } finally {
    await opened.loading.destroy();
  }
});
