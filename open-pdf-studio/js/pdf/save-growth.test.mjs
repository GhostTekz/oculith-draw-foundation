// Repeated saves without edits must not grow the file. The saver replaces each
// markup it manages with a fresh dictionary and appearance; the replaced ones
// must leave the PDF, while everything it does not manage (a link, a form
// widget, page content, fonts) stays as it was. A measurement keeps its
// Subject in /Subj (its /Contents holds the measured text). Real saver, real
// pdf.js reopen.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict, PDFArray, PDFRef, PDFStream, StandardFonts,
  decodePDFRawStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { statusReplyFromPdfAnnotation, applyStatusReplies } = await import('./loader/status-replies.js');
const { commentReplyFromPdfAnnotation, applyCommentReplies } = await import('./loader/comment-replies.js');
const { recalculateAllMeasurements } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { measureKindType, MEASURE_EXTRA_KEY } = await import('../annotations/measure-extras.js');
const { measurementLegend, legendTable } = await import('../quantities/measurement-legend.js');
const { formatMeasurement } = await import('../annotations/measurement.js');
const {
  createPolylengthMeasurement, createVolumeMeasurement, createArcMeasurement, createRadius3Measurement,
} = await import('../tools/measure-extra-creators.js');

const MM_100 = { pixelsPerUnit: 0.01, unit: 'mm' };
const SAVES = 5;

function openDocument(annotations) {
  state.documents = [{ id: `growth-${Math.random()}`, filePath: 'C:/growth/input.pdf', pdfDoc: {},
    currentPage: 1, annotations, measureScale: MM_100, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [] }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function save(bytes, annotations) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  openDocument(annotations);
  recalculateAllMeasurements();
  assert.equal(await savePDF('C:/growth/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return new Uint8Array(saved);
}

// The loader's page conversion (loader.js _convertAndPushAnnotations).
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
      if (!model || model.__textboxLeader) continue;
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
  return annotations;
}

// A page with real content, a font, a link, a form field and a note popup
// written by another program: none of it belongs to the markup saver.
async function sourcePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Ground floor plan', { x: 60, y: 780, size: 18, font });
  page.drawRectangle({ x: 50, y: 50, width: 495, height: 742, borderWidth: 1 });
  const form = doc.getForm();
  const field = form.createTextField('reviewer');
  field.setText('J. Doe');
  field.addToPage(page, { x: 400, y: 60, width: 120, height: 20 });
  const ctx = doc.context;
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, 770, 240, 800],
    Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.org/plan') } }));
  const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
  annots.push(link);
  return doc.save();
}

function buildModels() {
  const base = { page: 1, author: 'Reviewer' };
  const models = [
    createAnnotation({ ...base, type: 'box', x: 80, y: 100, width: 120, height: 60, color: '#e11d48',
      strokeColor: '#e11d48', subject: 'Clash with duct' }),
    createAnnotation({ ...base, type: 'box', x: 220, y: 100, width: 60, height: 60, color: '#2563eb',
      strokeColor: '#2563eb', fillColor: '#93c5fd', fillOpacity: 0.4 }),
    createAnnotation({ ...base, type: 'circle', x: 300, y: 100, width: 80, height: 50, color: '#16a34a',
      strokeColor: '#16a34a' }),
    createAnnotation({ ...base, type: 'line', startX: 80, startY: 200, endX: 260, endY: 220, color: '#000000',
      strokeColor: '#000000' }),
    createAnnotation({ ...base, type: 'arrow', startX: 80, startY: 240, endX: 260, endY: 260, color: '#9333ea',
      strokeColor: '#9333ea', endHead: 'open' }),
    createAnnotation({ ...base, type: 'draw', path: [{ x: 300, y: 200 }, { x: 320, y: 230 }, { x: 350, y: 210 },
      { x: 380, y: 250 }], color: '#ea580c', strokeColor: '#ea580c' }),
    createAnnotation({ ...base, type: 'polyline', points: [{ x: 400, y: 200 }, { x: 450, y: 240 }, { x: 500, y: 210 }],
      color: '#0f766e', strokeColor: '#0f766e' }),
    createAnnotation({ ...base, type: 'polygon', points: [{ x: 80, y: 300 }, { x: 160, y: 300 }, { x: 140, y: 360 }],
      color: '#0f172a', strokeColor: '#0f172a' }),
    createAnnotation({ ...base, type: 'cloud', x: 200, y: 300, width: 120, height: 70, color: '#dc2626',
      strokeColor: '#dc2626', subject: 'Revise' }),
    createAnnotation({ ...base, type: 'textbox', x: 340, y: 300, width: 150, height: 40, text: 'Check this wall',
      color: '#000000', strokeColor: '#000000', fontSize: 12, fontFamily: 'Helvetica' }),
    createAnnotation({ ...base, type: 'comment', x: 520, y: 300, width: 24, height: 24, text: 'Note text',
      color: '#facc15' }),
    createAnnotation({ ...base, type: 'highlight', x: 60, y: 60, width: 180, height: 22, color: '#fde047' }),
    createAnnotation({ ...base, type: 'stamp', x: 380, y: 400, width: 140, height: 40, stampName: 'Approved',
      stampText: 'APPROVED', color: '#16a34a' }),
    createAnnotation({ ...base, type: 'measureDistance', startX: 80, startY: 450, endX: 200, endY: 450,
      strokeColor: '#ff0000', subject: 'Opening width' }),
    createAnnotation({ ...base, type: 'measureArea', points: [{ x: 80, y: 500 }, { x: 180, y: 500 },
      { x: 180, y: 580 }, { x: 80, y: 580 }], strokeColor: '#ff0000' }),
    createAnnotation({ ...base, type: 'measurePerimeter', points: [{ x: 220, y: 500 }, { x: 300, y: 500 },
      { x: 300, y: 560 }], strokeColor: '#ff0000' }),
    createAnnotation({ ...base, type: 'measureAngle', point1: { x: 360, y: 500 }, vertex: { x: 400, y: 560 },
      point2: { x: 460, y: 520 }, strokeColor: '#ff0000' }),
    createPolylengthMeasurement([{ x: 100, y: 620 }, { x: 130, y: 620 }, { x: 130, y: 660 }]),
    createVolumeMeasurement([{ x: 200, y: 620 }, { x: 260, y: 620 }, { x: 260, y: 680 }, { x: 200, y: 680 }]),
    createArcMeasurement({ x: 300, y: 660 }, { x: 340, y: 620 }, { x: 380, y: 660 }),
    createRadius3Measurement({ x: 500, y: 660 }, { x: 460, y: 700 }, { x: 420, y: 660 }),
  ];
  models[0].replies = [
    { id: 'r1', author: 'Site', text: 'Moved 50 mm', createdAt: '2026-10-02T10:00:00.000Z' },
    { id: 'r2', author: 'Architect', text: 'Agreed', createdAt: '2026-10-03T10:00:00.000Z' },
  ];
  models[0].status = 'accepted';
  models[0].statusBy = 'Lead';
  models[0].statusAt = '2026-10-03T09:00:00.000Z';
  models[18].measureDepth = 0.3;
  models[18].measureDepthUnit = 'm';
  return models;
}

// Every indirect object reachable from the trailer.
function reachable(doc) {
  const ctx = doc.context;
  const seen = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
  while (stack.length) {
    let o = stack.pop();
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      o = ctx.lookup(o);
    }
    if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v);
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFStream) for (const [, v] of o.dict.entries()) stack.push(v);
  }
  return seen;
}

// The page's drawing operators, decoded and joined (refs may be renumbered).
function pageContent(doc) {
  const ctx = doc.context;
  const contents = doc.getPages()[0].node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map(r => ctx.lookup(r)) : [contents];
  return streams.map(st => Buffer.from(decodePDFRawStream(st).decode()).toString('latin1')).join('\n');
}

async function inspect(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const objects = ctx.enumerateIndirectObjects();
  const live = reachable(doc);
  const annots = doc.getPages()[0].node.lookup(PDFName.of('Annots'), PDFArray).asArray();
  const dicts = annots.map(ref => ctx.lookup(ref));
  const sub = d => d.get(PDFName.of('Subtype'))?.toString();
  const subtypes = {};
  for (const d of dicts) subtypes[sub(d)] = (subtypes[sub(d)] || 0) + 1;
  const foreign = dicts.filter(d => ['/Link', '/Widget'].includes(sub(d)))
    .map(d => `${sub(d)} ${[...d.entries()].map(([k, v]) => `${k}=${v}`).sort().join(' ')}`).sort();
  return {
    size: bytes.length,
    objects: objects.length,
    orphans: objects.filter(([ref]) => !live.has(ref.tag)).map(([ref]) => ref.toString()),
    subtypes,
    foreign,
    withAp: dicts.filter(d => d.get(PDFName.of('AP'))).length,
    extras: dicts.filter(d => d.get(PDFName.of(MEASURE_EXTRA_KEY))).length,
    replies: dicts.filter(d => d.get(PDFName.of('IRT'))).length,
    content: pageContent(doc),
  };
}

function summary(models) {
  return models.map(m => [measureKindType(m), m.subject || '', m.replies?.length || 0, m.status || ''].join('|')).sort();
}

test(`${SAVES} saves without edits keep size and object count stable and write no orphans`, async () => {
  openDocument([]);
  const models = buildModels();
  const source = await sourcePdf();
  // pdf-lib leaves the first appearance of the form field behind in the
  // source: garbage of another program, which the saver does not touch.
  const sourceOrphans = (await inspect(source)).orphans;
  assert.equal(sourceOrphans.length, 1);
  const first = await save(source, models);
  let bytes = first;
  const rounds = [await inspect(first)];
  const firstModels = summary(await reopen(first));
  assert.equal(firstModels.length, models.length, 'every markup reopens');
  for (let i = 0; i < SAVES; i++) {
    const loaded = await reopen(bytes);
    assert.deepEqual(summary(loaded), firstModels, `save ${i + 2}: the same markups reopen`);
    bytes = await save(bytes, loaded);
    rounds.push(await inspect(bytes));
  }
  console.log('sizes', rounds.map(r => r.size).join(' '), 'objects', rounds.map(r => r.objects).join(' '));
  const ref = rounds[1];
  for (const [i, r] of rounds.entries()) {
    assert.deepEqual(r.orphans, sourceOrphans, `save ${i + 1}: no unreferenced objects of its own`);
    assert.deepEqual(r.subtypes, rounds[0].subtypes, `save ${i + 1}: same annotations per subtype`);
    assert.deepEqual(r.foreign, rounds[0].foreign, `save ${i + 1}: link and widget unchanged`);
    assert.equal(r.withAp, rounds[0].withAp, `save ${i + 1}: same appearances`);
    assert.equal(r.extras, 4, `save ${i + 1}: polylength, volume, arc and radius extras kept`);
    assert.equal(r.replies, rounds[0].replies, `save ${i + 1}: replies and statuses kept`);
    assert.equal(r.content, rounds[0].content, `save ${i + 1}: page content untouched`);
    if (i < 1) continue;
    assert.equal(r.objects, ref.objects, `save ${i + 1}: object count stable`);
    assert.ok(Math.abs(r.size - ref.size) <= 64, `save ${i + 1}: ${r.size} bytes vs ${ref.size}`);
  }
  assert.equal(rounds[0].subtypes['/Link'], 1);
  assert.equal(rounds[0].subtypes['/Widget'], 1);
  assert.ok(rounds[0].replies >= 3, 'two replies and a status reply');
});

test('a popup from another program stays with its note and the note does not pile up', async () => {
  const doc = await PDFDocument.load(await sourcePdf());
  const ctx = doc.context;
  const page = doc.getPages()[0];
  const note = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [100, 400, 120, 420],
    T: PDFHexString.fromText('Designer'), Contents: PDFHexString.fromText('Door swing'), C: [1, 1, 0] });
  const noteRef = ctx.register(note);
  const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [130, 380, 300, 460],
    Parent: noteRef, Open: false }));
  note.set(PDFName.of('Popup'), popup);
  page.node.lookup(PDFName.of('Annots'), PDFArray).push(noteRef);
  page.node.lookup(PDFName.of('Annots'), PDFArray).push(popup);
  let bytes = await doc.save();
  const sourceOrphans = (await inspect(bytes)).orphans;
  const rounds = [];
  for (let i = 0; i < 4; i++) {
    const loaded = await reopen(bytes);
    assert.equal(loaded.filter(m => m.type === 'comment').length, 1, `save ${i + 1}: one note`);
    bytes = await save(bytes, loaded);
    rounds.push(await inspect(bytes));
  }
  for (const r of rounds) {
    assert.deepEqual(r.orphans, sourceOrphans);
    assert.equal(r.subtypes['/Popup'], 1, 'the popup stays');
    assert.equal(r.subtypes['/Text'], 1, 'one note');
    assert.equal(r.objects, rounds[0].objects, 'object count stable');
  }
});

test('measurement, note, text box, label and markup Subjects survive save and reopen twice', async () => {
  openDocument([]);
  const base = { page: 1, author: 'Reviewer' };
  const models = [
    createAnnotation({ ...base, type: 'measureDistance', startX: 80, startY: 450, endX: 200, endY: 450,
      strokeColor: '#ff0000', subject: 'Opening width' }),
    createAnnotation({ ...base, type: 'measureArea', points: [{ x: 80, y: 500 }, { x: 180, y: 500 },
      { x: 180, y: 580 }, { x: 80, y: 580 }], strokeColor: '#ff0000', subject: 'Floor area — Ølkjeller' }),
    createAnnotation({ ...base, type: 'measurePerimeter', points: [{ x: 220, y: 500 }, { x: 300, y: 500 },
      { x: 300, y: 560 }], strokeColor: '#ff0000', subject: 'Skirting' }),
    createAnnotation({ ...base, type: 'measureAngle', point1: { x: 360, y: 500 }, vertex: { x: 400, y: 560 },
      point2: { x: 460, y: 520 }, strokeColor: '#ff0000', subject: 'Roof pitch' }),
    Object.assign(createPolylengthMeasurement([{ x: 100, y: 620 }, { x: 130, y: 620 }, { x: 130, y: 660 }]),
      { subject: 'Cable run' }),
    Object.assign(createVolumeMeasurement([{ x: 200, y: 620 }, { x: 260, y: 620 }, { x: 260, y: 680 }]),
      { subject: 'Concrete pour', measureDepth: 0.3, measureDepthUnit: 'm' }),
    createAnnotation({ ...base, type: 'measureArea', points: [{ x: 400, y: 620 }, { x: 460, y: 620 },
      { x: 460, y: 680 }], strokeColor: '#ff0000' }),
    createAnnotation({ ...base, type: 'box', x: 80, y: 100, width: 120, height: 60, color: '#e11d48',
      strokeColor: '#e11d48', subject: 'Clash with duct' }),
    createAnnotation({ ...base, type: 'line', startX: 80, startY: 200, endX: 260, endY: 220, color: '#000000',
      strokeColor: '#000000', subject: 'Grid line A' }),
    createAnnotation({ ...base, type: 'cloud', x: 200, y: 300, width: 120, height: 70, color: '#dc2626',
      strokeColor: '#dc2626', subject: 'Revise detail' }),
    // Kinds whose own text (note, box text, label) also lives in /Contents.
    createAnnotation({ ...base, type: 'textbox', x: 340, y: 300, width: 150, height: 40, text: 'Check this wall',
      color: '#000000', strokeColor: '#000000', fontSize: 12, fontFamily: 'Helvetica', subject: 'Wall note' }),
    createAnnotation({ ...base, type: 'callout', x: 340, y: 360, width: 150, height: 40, text: 'Beam here',
      color: '#000000', strokeColor: '#000000', fontSize: 12, fontFamily: 'Helvetica', subject: 'Beam callout',
      arrowX: 300, arrowY: 420, kneeX: 320, kneeY: 400 }),
    createAnnotation({ ...base, type: 'comment', x: 520, y: 300, width: 24, height: 24, text: 'Note text',
      color: '#facc15', subject: 'Site question' }),
    createAnnotation({ ...base, type: 'stavenreeks', startX: 100, startY: 740, endX: 220, endY: 740,
      color: '#000000', subject: 'Rebar set B' }),
    createAnnotation({ ...base, type: 'scaleBar', x: 300, y: 740, width: 160, height: 24, color: '#000000',
      subject: 'Plan scale' }),
    (() => {
      const table = legendTable(measurementLegend([{ type: 'measureArea', page: 1, measureValue: 12.5,
        measureUnit: 'ft²', color: '#0000ff', subject: 'Slab' }], { page: 1 }), { title: 'Legend', color: 'Color',
        subject: 'Subject', count: 'Count', total: 'Total', typeName: () => 'Area' }, formatMeasurement);
      return createAnnotation({ ...base, type: 'scheduleTable', x: 36, y: 20, width: table.width,
        height: table.height, title: table.title, columns: table.columns, rows: table.rows,
        color: '#000000', lineWidth: 0.5, opacity: 1, subject: 'Quantities' });
    })(),
  ];
  const expected = models.map(m => [measureKindType(m), m.subject || '']).sort();
  const texts = models.filter(m => m.type.startsWith('measure')).length;
  let bytes = await sourcePdf();
  let current = models;
  for (let i = 0; i < 2; i++) {
    bytes = await save(bytes, current);
    current = await reopen(bytes);
    assert.deepEqual(current.map(m => [measureKindType(m), m.subject || '']).sort(), expected, `save ${i + 1}`);
    // The measurement text stays in /Contents, beside the Subject.
    assert.equal(current.filter(m => m.type.startsWith('measure') && m.measureText
      && m.measureText !== m.subject).length, texts, `save ${i + 1}: measurement texts kept`);
  }
  const doc = await PDFDocument.load(bytes);
  const subj = doc.getPages()[0].node.lookup(PDFName.of('Annots'), PDFArray).asArray()
    .map(ref => doc.context.lookup(ref).get(PDFName.of('Subj'))?.decodeText?.()).filter(Boolean);
  // Six measurements and six kinds with their own /Contents text carry the
  // user's Subject; the other markups carry the external editor's default Subject (as the external editor
  // writes it), not their comment.
  const gegeven = models.filter(m => m.subject && !['box', 'line', 'cloud'].includes(m.type)).map(m => m.subject);
  assert.equal(gegeven.filter(s => subj.includes(s)).length, 12, 'those Subjects are in /Subj');
  for (const standaard of ['Rectangle', 'Line', 'Cloud']) assert.ok(subj.includes(standaard), `the file's ${standaard} Subject`);
  assert.ok(!subj.includes('Clash with duct'), 'a shape comment stays in /Contents');
});
