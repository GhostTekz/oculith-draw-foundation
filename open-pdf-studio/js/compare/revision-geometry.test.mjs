import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, PDFNumber, PDFString, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCompareChangeReportModel } from './change-report.js';
import { pageViewBoundsToPdfRect, visualChangeToPdfReviewRegion } from './revision-geometry.js';

const expectedRect = [80, 110, 190, 250];

async function fixture() {
  const pdf = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = pdf.addPage([600, 800]);
    page.setCropBox(50, 70, 300, 400);
    page.setRotation(degrees(rotation));
  }
  const userUnitPage = pdf.addPage([600, 800]);
  userUnitPage.setCropBox(50, 70, 300, 400);
  userUnitPage.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  return pdf.save();
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} vs ${expected}`);
}

function visualBoundsForPdfRect(viewport, rect) {
  const corners = [
    viewport.convertToViewportPoint(rect[0], rect[1]),
    viewport.convertToViewportPoint(rect[2], rect[1]),
    viewport.convertToViewportPoint(rect[2], rect[3]),
    viewport.convertToViewportPoint(rect[0], rect[3]),
  ];
  const xs = corners.map(point => point[0]);
  const ys = corners.map(point => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

test('real cropped, rotated and UserUnit PDFs map reported visual bounds back to PDF user space', async () => {
  const loading = getDocument({ data: new Uint8Array(await fixture()), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    for (let pageNumber = 1; pageNumber <= 5; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const view = visualBoundsForPdfRect(viewport, expectedRect);
      const detectScale = 0.8;
      const report = createCompareChangeReportModel({
        oldPath: '/issued.pdf', newPath: '/revised.pdf', oldPage: pageNumber + 5, newPage: pageNumber,
        pairing: { source: 'manual', oldPage: pageNumber + 5, newPage: pageNumber, confirmedAt: '2026-10-13T19:00:00.000Z' },
        changes: [{ type: 'modified', x: view.x * detectScale, y: view.y * detectScale,
          width: view.width * detectScale, height: view.height * detectScale, detectScale }],
      });
      const region = visualChangeToPdfReviewRegion({ report, change: report.changes[0], pdfPage: page, targetPath: '/revised.pdf' });
      for (let index = 0; index < 4; index++) near(region.pdfRect[index], expectedRect[index], `page ${pageNumber}, coordinate ${index}`);
      assert.equal(region.targetPage, pageNumber);
      assert.equal(region.oldPage, pageNumber + 5);
      assert.equal(region.pairingStatus, 'confirmed manually');
      assert.equal(region.reviewState, 'unreviewed');
      assert.equal(region.clippedToPage, false);
    }
  } finally {
    await loading.destroy();
  }
});

test('converted region can be written as a PDF annotation and reopened at the intended rectangle', async () => {
  const original = await fixture();
  const loading = getDocument({ data: new Uint8Array(original), useSystemFonts: false });
  let region;
  try {
    const page = await (await loading.promise).getPage(2); // cropped and rotated 90 degrees
    const view = visualBoundsForPdfRect(page.getViewport({ scale: 1 }), expectedRect);
    const report = createCompareChangeReportModel({
      oldPath: 'old.pdf', newPath: 'new.pdf', oldPage: 6, newPage: 2,
      pairing: { source: 'manual', oldPage: 6, newPage: 2, confirmedAt: '2026-10-13T19:00:00.000Z' },
      changes: [{ type: 'added', ...view, detectScale: 1 }],
    });
    region = visualChangeToPdfReviewRegion({ report, change: report.changes[0], pdfPage: page, targetPath: 'new.pdf' });
  } finally {
    await loading.destroy();
  }
  const output = await PDFDocument.load(original);
  const target = output.getPage(1);
  const context = output.context;
  target.node.set(PDFName.of('Annots'), context.obj([context.register(context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: region.pdfRect, C: [1, 0, 0],
    Contents: PDFString.of('Unreviewed comparison region'), F: 4,
  }))]));
  const reopened = getDocument({ data: new Uint8Array(await output.save()), useSystemFonts: false });
  try {
    const page = await (await reopened.promise).getPage(2);
    const [annotation] = (await page.getAnnotations()).filter(item => item.subtype === 'Square');
    assert.ok(annotation);
    for (let index = 0; index < 4; index++) near(annotation.rect[index], expectedRect[index], `reopened coordinate ${index}`);
    assert.equal(annotation.contentsObj.str, 'Unreviewed comparison region');
  } finally {
    await reopened.destroy();
  }
});

test('visible page clipping and provenance checks fail closed', async () => {
  const loading = getDocument({ data: new Uint8Array(await fixture()), useSystemFonts: false });
  try {
    const page = await (await loading.promise).getPage(2);
    const viewport = page.getViewport({ scale: 1 });
    assert.throws(() => pageViewBoundsToPdfRect(page, { x: -20, y: 1, width: 10, height: 10 }), /outside/u);
    assert.throws(() => pageViewBoundsToPdfRect(page, { x: 1, y: 1, width: NaN, height: 10 }), /Finite/u);
    const clipped = pageViewBoundsToPdfRect(page, { x: viewport.width - 5, y: 2, width: 12, height: 15 });
    assert.equal(clipped.clippedToPage, true);
    for (const point of [
      [clipped.rect[0], clipped.rect[1]], [clipped.rect[2], clipped.rect[3]],
    ]) assert.ok(point[0] >= page.view[0] && point[0] <= page.view[2] && point[1] >= page.view[1] && point[1] <= page.view[3]);

    const report = createCompareChangeReportModel({
      oldPath: 'old.pdf', newPath: 'new.pdf', oldPage: 1, newPage: 2,
      pairing: { source: 'manual', oldPage: 1, newPage: 2 },
      changes: [{ type: 'removed', x: 5, y: 5, width: 10, height: 10, detectScale: 1 }],
    });
    const options = { report, change: report.changes[0], pdfPage: page, targetPath: 'new.pdf' };
    assert.throws(() => visualChangeToPdfReviewRegion({ ...options, targetPath: 'other.pdf' }), /target PDF path/u);
    assert.throws(() => visualChangeToPdfReviewRegion({ ...options, report: { ...report, pairingStatus: 'unconfirmed' } }), /manually confirmed/u);
    assert.throws(() => visualChangeToPdfReviewRegion({ ...options, change: { ...options.change, reviewState: 'accepted' } }), /unreviewed visual/u);
    assert.throws(() => visualChangeToPdfReviewRegion({ ...options, change: { ...options.change, pageView: { ...options.change.pageView, frame: 'old page' } } }), /aligned new-page/u);
    const wrongPage = await (await loading.promise).getPage(1);
    assert.throws(() => visualChangeToPdfReviewRegion({ ...options, pdfPage: wrongPage }), /target PDF path and page/u);
  } finally {
    await loading.destroy();
  }
});
