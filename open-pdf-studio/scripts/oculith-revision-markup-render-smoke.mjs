import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCompareChangeReportModel } from '../js/compare/change-report.js';
import { buildRevisionMarkupPdf } from '../js/compare/revision-markup-pdf.js';
import { renderPagePng } from './pdfium-page-png.mjs';
const pdf = await PDFDocument.create();
const sheet = pdf.addPage([600, 800]);
sheet.setCropBox(40, 60, 400, 500);
sheet.setRotation(degrees(90));
const source = await pdf.save();
const loading = getDocument({ data: source.slice(), useSystemFonts: false });
const pdfRect = [100, 180, 220, 300];
let marked;
let viewRect;
try {
  const page = await (await loading.promise).getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const a = viewport.convertToViewportPoint(pdfRect[0], pdfRect[1]);
  const b = viewport.convertToViewportPoint(pdfRect[2], pdfRect[3]);
  viewRect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
    width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
  const report = createCompareChangeReportModel({
    oldPath: 'issued.pdf', newPath: 'revised.pdf', oldPage: 1, newPage: 1,
    pairing: { oldPage: 1, newPage: 1, source: 'manual', confirmedAt: '2026-10-13T19:00:00.000Z' },
    changes: [{ type: 'added', ...viewRect, detectScale: 1 }],
  });
  marked = (await buildRevisionMarkupPdf({
    newBytes: source, report, change: report.changes[0], pdfPage: page,
    targetPath: 'revised.pdf', markupId: 'render-smoke',
  })).bytes;
} finally {
  await loading.destroy();
}

const [before, after] = await Promise.all([source, marked].map(async (bytes) => {
  const { data, info } = await sharp(await renderPagePng(bytes, { dpi: 72, annotations: true }))
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}));
assert.equal(after.info.width, before.info.width);
assert.equal(after.info.height, before.info.height);
assert.equal(after.info.width, 500); // rotated 400 x 500 CropBox
assert.equal(after.info.height, 400);
const changed = (x, y) => {
  const index = (y * before.info.width + x) * 3;
  return [0, 1, 2].some(channel => Math.abs(after.data[index + channel] - before.data[index + channel]) > 40);
};
const sidePixels = [0, 0, 0, 0];
const x1 = Math.round(viewRect.x), x2 = Math.round(viewRect.x + viewRect.width);
const y1 = Math.round(viewRect.y), y2 = Math.round(viewRect.y + viewRect.height);
for (let y = 0; y < after.info.height; y++) for (let x = 0; x < after.info.width; x++) {
  if (!changed(x, y)) continue;
  if (Math.abs(y - y1) <= 3 && x >= x1 - 3 && x <= x2 + 3) sidePixels[0]++;
  if (Math.abs(x - x2) <= 3 && y >= y1 - 3 && y <= y2 + 3) sidePixels[1]++;
  if (Math.abs(y - y2) <= 3 && x >= x1 - 3 && x <= x2 + 3) sidePixels[2]++;
  if (Math.abs(x - x1) <= 3 && y >= y1 - 3 && y <= y2 + 3) sidePixels[3]++;
}
assert.ok(sidePixels.every(count => count > 20), `Independent PDF render lacks an outlined side: ${sidePixels}`);
console.log(`Revision markup render smoke passed: four visible sides in PDFium (${sidePixels.join(', ')})`);
