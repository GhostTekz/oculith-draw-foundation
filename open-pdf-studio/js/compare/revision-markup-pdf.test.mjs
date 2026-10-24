import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, decodePDFRawStream, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCompareChangeReportModel } from './change-report.js';
import { buildRevisionMarkupPdf, buildRevisionMarkupsPdf, outputPathMatchesSource, suggestedRevisionMarkupName, suggestedRevisionMarkupsName, verifyComparisonSourceBytes } from './revision-markup-pdf.js';

async function fixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.setCropBox(40, 60, 400, 500);
  page.setRotation(degrees(90));
  const context = pdf.context;
  page.node.set(PDFName.of('Annots'), context.obj([context.register(context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [65, 75, 80, 90],
    Contents: 'Existing note', F: 4,
  }))]));
  return pdf.save();
}

test('one selected visual change becomes an editable PDF markup with provenance after reopen', async () => {
  const source = await fixture();
  const loading = getDocument({ data: source.slice(), useSystemFonts: false });
  let result;
  try {
    const page = await (await loading.promise).getPage(1);
    const bounds = [90, 120, 180, 210];
    const viewport = page.getViewport({ scale: 1 });
    const points = [viewport.convertToViewportPoint(bounds[0], bounds[1]), viewport.convertToViewportPoint(bounds[2], bounds[3])];
    const x = Math.min(points[0][0], points[1][0]);
    const y = Math.min(points[0][1], points[1][1]);
    const report = createCompareChangeReportModel({
      oldPath: '/plans/Résumé issued.pdf', newPath: '/plans/新 revision.pdf', oldPage: 3, newPage: 1,
      pairing: { source: 'manual', oldPage: 3, newPage: 1, confirmedAt: '2026-10-13T19:00:00.000Z' },
      offset: { dx: 8, dy: -3, rotation: 2 },
      changes: [{ type: 'added', x, y, width: Math.abs(points[0][0] - points[1][0]), height: Math.abs(points[0][1] - points[1][1]), detectScale: 1 }],
    });
    result = await buildRevisionMarkupPdf({
      newBytes: source, report, change: report.changes[0], pdfPage: page,
      targetPath: report.newPath, markupId: 'revision-1',
    });
  } finally {
    await loading.destroy();
  }
  const reopened = getDocument({ data: result.bytes.slice(), useSystemFonts: false });
  try {
    const page = await (await reopened.promise).getPage(1);
    const annotations = await page.getAnnotations();
    assert.equal(annotations.filter(item => item.subtype === 'Text').length, 1);
    const [annotation] = annotations.filter(item => item.subtype === 'Square');
    assert.ok(annotation);
    assert.equal(annotation.contentsObj.str, result.content);
    assert.equal(annotation.annotationFlags & (64 | 128), 0);
    for (const [index, value] of [90, 120, 180, 210].entries()) {
      assert.ok(Math.abs(annotation.rect[index] - value) < 0.01);
    }
    assert.match(result.content, /UNREVIEWED/u);
    assert.match(result.content, /Résumé issued\.pdf — page 3/u);
    assert.match(result.content, /新 revision\.pdf — page 1/u);
    assert.match(result.content, /confirmed manually at 2026-10-13T19:00:00/u);
    assert.match(result.content, /dx 8 display px; dy -3 display px; rotation 2 deg/u);
  } finally {
    await reopened.destroy();
  }
  const saved = await PDFDocument.load(result.bytes);
  const dict = saved.context.lookup(saved.getPage(0).node.lookup(PDFName.of('Annots')).asArray()[1]);
  assert.equal(dict.get(PDFName.of('NM')).decodeText(), 'revision-1');
  assert.equal(dict.get(PDFName.of('Subj')).decodeText(), 'Unreviewed revision difference');
  const appearance = saved.context.lookup(saved.context.lookup(dict.get(PDFName.of('AP'))).get(PDFName.of('N')));
  assert.ok(appearance, 'the exported Square has a normal appearance stream');
  assert.match(new TextDecoder().decode(decodePDFRawStream(appearance).decode()), / re S/u);
  assert.equal(suggestedRevisionMarkupName('/plans/新 revision.pdf', 1, 2), '新_revision-p1-change-2-review.pdf');
});

test('loaded, cached and current on-disk bytes must all match for both source PDFs', async () => {
  const old = await fixture();
  const newer = new Uint8Array([...old, 10]);
  const params = {
    oldPath: 'old.pdf', newPath: 'new.pdf',
    oldDoc: { getData: async () => old }, newDoc: { getData: async () => old },
    getCachedBytes: () => old,
    readCurrentBytes: async () => old,
  };
  const okay = await verifyComparisonSourceBytes(params);
  assert.equal(okay.identity.old, okay.identity.new);
  assert.notEqual(okay.newBytes, old);
  await assert.rejects(verifyComparisonSourceBytes({ ...params, getCachedBytes: path => path === 'new.pdf' ? newer : old }), /source PDF changed/u);
  await assert.rejects(verifyComparisonSourceBytes({ ...params, readCurrentBytes: async path => path === 'old.pdf' ? newer : old }), /source PDF changed/u);
  await assert.rejects(verifyComparisonSourceBytes({ ...params, newDoc: { getData: async () => newer } }), /source PDF changed/u);
});

test('all confirmed visual regions reopen as separate editable markups with per-change provenance', async () => {
  const source = await fixture();
  const loading = getDocument({ data: source.slice(), useSystemFonts: false });
  let result;
  try {
    const page = await (await loading.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const bounds = [[90, 120, 150, 190], [220, 260, 280, 330]];
    const changes = bounds.map(([x1, y1, x2, y2], index) => {
      const a = viewport.convertToViewportPoint(x1, y1);
      const b = viewport.convertToViewportPoint(x2, y2);
      return { type: index ? 'removed' : 'added', x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
        width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), detectScale: 1 };
    });
    const report = createCompareChangeReportModel({
      oldPath: 'issued.pdf', newPath: 'revised.pdf', oldPage: 4, newPage: 1,
      pairing: { source: 'manual', oldPage: 4, newPage: 1, confirmedAt: '2026-10-13T19:00:00.000Z' },
      changes,
    });
    result = await buildRevisionMarkupsPdf({ newBytes: source, report, changes: report.changes,
      pdfPage: page, targetPath: report.newPath, markupIds: ['revision-a', 'revision-b'] });
    assert.equal(result.entries.length, 2);
    assert.deepEqual(result.entries.map(entry => entry.region.changeNumber), [1, 2]);
    await assert.rejects(buildRevisionMarkupsPdf({ newBytes: source, report: { ...report, pairingStatus: 'unconfirmed' },
      changes: report.changes, pdfPage: page, targetPath: report.newPath }), /manually confirmed/u);
    await assert.rejects(buildRevisionMarkupsPdf({ newBytes: source, report, changes: report.changes,
      pdfPage: page, targetPath: report.newPath, markupIds: ['duplicate', 'duplicate'] }), /distinct reference/u);
  } finally {
    await loading.destroy();
  }
  const reopened = getDocument({ data: result.bytes.slice(), useSystemFonts: false });
  try {
    const page = await (await reopened.promise).getPage(1);
    const squares = (await page.getAnnotations()).filter(item => item.subtype === 'Square');
    assert.equal(squares.length, 2);
    for (const [index, square] of squares.entries()) {
      assert.equal(square.contentsObj.str, result.entries[index].content);
      assert.match(square.contentsObj.str, new RegExp(`Change: ${index + 1} \\(`, 'u'));
      assert.match(square.contentsObj.str, /Old source: issued\.pdf — page 4/u);
      assert.match(square.contentsObj.str, /New source: revised\.pdf — page 1/u);
      assert.equal(square.annotationFlags & (64 | 128), 0);
    }
  } finally {
    await reopened.destroy();
  }
  assert.equal(suggestedRevisionMarkupsName('revised.pdf', 1), 'revised-p1-changes-review.pdf');
});

test('the marked-up copy cannot overwrite either source through a path spelling alias', () => {
  assert.equal(outputPathMatchesSource('C:\\Plans\\.\\REVISED.pdf', 'c:/plans/revised.pdf', 'c:/plans/issued.pdf'), true);
  assert.equal(outputPathMatchesSource('/plans/archive/../issued.pdf', '/plans/issued.pdf', '/plans/revised.pdf'), true);
  assert.equal(outputPathMatchesSource('/plans/revised-review.pdf', '/plans/revised.pdf'), false);
});
