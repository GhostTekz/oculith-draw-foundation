// Line, cloud, text, stamp, count, and polygon through two saves on one
// /Rotate 90 page whose CropBox origin is not (0, 0). Coordinates stay in the
// page view the saver and loader already convert; this test does not flip them.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { degrees, PDFDocument } from 'pdf-lib';

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
const { statusReplyFromPdfAnnotation, applyStatusReplies } = await import('./loader/status-replies.js');
const { commentReplyFromPdfAnnotation, applyCommentReplies } = await import('./loader/comment-replies.js');
const { leesAnnotatieLagen, pasGelezenLagenToe } = await import('./saver/annotatie-lagen.js');
const { addLayer } = await import('../annotations/annotatie-lagen.js');
const { applyStatusChange } = await import('../annotations/markup-status.js');
const { markupReplies } = await import('../annotations/markup-replies.js');
const { CONTRACTOR_STAMPS, instantiateStampTemplate, stampDesignText } = await import('../annotations/stamp-templates.js');
const { stampDesignSize } = await import('../annotations/stamp-layout.js');

const COMMENT = 'Check the hinge';
const STATUS = 'accepted';
const SUBJECT = 'Clash';
const LAYER_NAME = 'Review hold';
const TEXT = 'Check beam';
const COUNT_NUMBER = 7;
const LINE = { startX: 72, startY: 48, endX: 240, endY: 150 };
const CLOUD = { x: 80, y: 220, width: 150, height: 80 };
const TEXT_BOX = { x: 280, y: 40, width: 180, height: 56 };
const COUNT_AT = { x: 150, y: 400 };
const POLY = [
  { x: 420, y: 80 },
  { x: 560, y: 110 },
  { x: 520, y: 240 },
  { x: 400, y: 200 },
];
const STAMP_AT = { x: 300, y: 320 };
const NOW = new Date(2026, 9, 14, 9, 5);
const FIELDS = { now: NOW, user: 'Jason Niewoit', page: 1, pageLabel: 'A-101', fileName: 'C:/jobs/Tower/A-101.pdf' };

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} != ${expected}`);
}

function stampAt(x, y) {
  const design = instantiateStampTemplate(CONTRACTOR_STAMPS.find(t => t.id === 'ct:approvedAsNoted'), FIELDS);
  const size = stampDesignSize(design);
  return createAnnotation({
    type: 'stamp', page: 1, x, y, width: size.width, height: size.height,
    rotation: 0, opacity: 1, stampName: design.name, stampText: stampDesignText(design),
    stampTemplateId: design.templateId, stampDesign: design, stampColor: design.color, color: design.color,
    author: 'Jason Niewoit',
  });
}

function placed() {
  const doc = { annotations: [] };
  const layer = addLayer(doc, { name: LAYER_NAME }).layer;
  assert.ok(layer, 'the review layer is stored on the document');
  const line = createAnnotation({
    type: 'line', page: 1, ...LINE,
    color: '#d0021b', strokeColor: '#d0021b', lineWidth: 2,
    subject: SUBJECT, layer: layer.id, author: 'Reviewer',
  });
  applyStatusChange(line, STATUS, 'Lead', '2026-10-03T09:00:00.000Z');
  line.replies = [
    { id: 'c1', author: 'Site', text: COMMENT, createdAt: '2026-10-02T10:00:00.000Z' },
  ];
  const cloud = createAnnotation({
    type: 'cloud', page: 1, ...CLOUD,
    color: '#1e40af', strokeColor: '#1e40af', lineWidth: 2,
  });
  const text = createAnnotation({
    type: 'textbox', page: 1, ...TEXT_BOX,
    text: TEXT, fontSize: 14, color: '#000000', strokeColor: '#000000', fillColor: '#fff7cc', lineWidth: 1,
  });
  const stamp = stampAt(STAMP_AT.x, STAMP_AT.y);
  const count = createAnnotation({
    type: 'count', page: 1, ...COUNT_AT,
    categoryId: 'doors-A', number: COUNT_NUMBER, markerStyle: 'dot', color: '#e11d48', opacity: 1,
  });
  const xs = POLY.map(p => p.x);
  const ys = POLY.map(p => p.y);
  const polygon = createAnnotation({
    type: 'polygon', page: 1,
    points: POLY.map(p => ({ ...p })),
    x: Math.min(...xs), y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    color: '#047857', strokeColor: '#047857', lineWidth: 2,
  });
  doc.annotations = [line, cloud, text, stamp, count, polygon];
  doc.stampBox = { width: stamp.width, height: stamp.height };
  doc.layerId = layer.id;
  return doc;
}

async function save(bytes, model) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  const annotations = model.annotations.map(annotation => JSON.parse(JSON.stringify(annotation)));
  const annotationLayers = model.annotationLayers?.map(layer => ({ ...layer }));
  state.documents = [{
    id: 'markup-persistence-roundtrip', filePath: 'C:/markups/input.pdf', pdfDoc: {},
    currentPage: 1, annotations, annotationLayers, currentLayerId: model.currentLayerId,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
  }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/markups/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

async function reopen(bytes) {
  const pdfLibDoc = await PDFDocument.load(bytes.slice());
  const colors = await extractAnnotationColors(1, pdfLibDoc);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  const annotations = [];
  try {
    const page = await reader.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const byPdfId = new Map();
    const statuses = [];
    const replies = [];
    for (const annot of await page.getAnnotations()) {
      const status = statusReplyFromPdfAnnotation(annot);
      if (status) { statuses.push(status); continue; }
      const reply = commentReplyFromPdfAnnotation(annot);
      if (reply) { replies.push({ ...reply, annot }); continue; }
      const model = await convertPdfAnnotation(annot, 1, viewport, new Map(), colors);
      if (!model) continue;
      if (annot.id) byPdfId.set(annot.id, model);
      annotations.push(model);
    }
    for (const orphan of applyCommentReplies(replies, byPdfId)) {
      const model = await convertPdfAnnotation(orphan.annot, 1, viewport, new Map(), colors);
      if (model) annotations.push(model);
    }
    applyStatusReplies(statuses, byPdfId);
  } finally {
    await task.destroy();
  }
  const doc = { annotations };
  pasGelezenLagenToe(doc, leesAnnotatieLagen(pdfLibDoc));
  return doc;
}

function only(annotations, type) {
  const found = annotations.filter(annotation => annotation.type === type);
  assert.equal(found.length, 1, `${type} is present once`);
  return found[0];
}

function assertRoundtrip(doc, stampBox, layerId) {
  const types = ['line', 'cloud', 'textbox', 'stamp', 'count', 'polygon'];
  assert.equal(doc.annotations.length, types.length, 'no duplicate or extra markup');
  for (const type of types) assert.equal(doc.annotations.filter(annotation => annotation.type === type).length, 1);

  const line = only(doc.annotations, 'line');
  assert.equal(line.page, 1);
  close(line.startX, LINE.startX, 'line startX');
  close(line.startY, LINE.startY, 'line startY');
  close(line.endX, LINE.endX, 'line endX');
  close(line.endY, LINE.endY, 'line endY');
  assert.deepEqual(markupReplies(line).map(reply => reply.text), [COMMENT]);
  assert.equal(line.status, STATUS);
  assert.equal(line.subject, SUBJECT);
  assert.equal(line.layer, layerId);
  const layer = doc.annotationLayers?.find(item => item.id === layerId);
  assert.equal(layer?.name, LAYER_NAME);

  const cloud = only(doc.annotations, 'cloud');
  assert.equal(cloud.page, 1);
  close(cloud.x, CLOUD.x, 'cloud x');
  close(cloud.y, CLOUD.y, 'cloud y');
  close(cloud.width, CLOUD.width, 'cloud width');
  close(cloud.height, CLOUD.height, 'cloud height');

  const text = only(doc.annotations, 'textbox');
  assert.equal(text.page, 1);
  assert.equal(text.text, TEXT);
  close(text.x, TEXT_BOX.x, 'text x');
  close(text.y, TEXT_BOX.y, 'text y');
  close(text.width, TEXT_BOX.width, 'text width');
  close(text.height, TEXT_BOX.height, 'text height');

  const stamp = only(doc.annotations, 'stamp');
  assert.equal(stamp.page, 1);
  close(stamp.x, STAMP_AT.x, 'stamp x');
  close(stamp.y, STAMP_AT.y, 'stamp y');
  close(stamp.width, stampBox.width, 'stamp width');
  close(stamp.height, stampBox.height, 'stamp height');

  const count = only(doc.annotations, 'count');
  assert.equal(count.page, 1);
  assert.equal(count.number, COUNT_NUMBER);
  close(count.x, COUNT_AT.x, 'count x');
  close(count.y, COUNT_AT.y, 'count y');

  const polygon = only(doc.annotations, 'polygon');
  assert.equal(polygon.page, 1);
  assert.equal(polygon.points.length, POLY.length);
  for (const [index, point] of POLY.entries()) {
    close(polygon.points[index].x, point.x, `polygon ${index} x`);
    close(polygon.points[index].y, point.y, `polygon ${index} y`);
  }
}

test('line, cloud, text, stamp, count, and polygon survive two saves on a rotated cropped page', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([700, 900]);
  page.setCropBox(40, 50, 600, 800);
  page.setRotation(degrees(90));
  const model = placed();
  const firstBytes = await save(await source.save(), model);
  const first = await reopen(firstBytes);
  assertRoundtrip(first, model.stampBox, model.layerId);
  const secondBytes = await save(firstBytes, first);
  const second = await reopen(secondBytes);
  assertRoundtrip(second, model.stampBox, model.layerId);
});
