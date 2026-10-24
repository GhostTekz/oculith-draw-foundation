// Markups List threads: replies are saved as Text annotations with /IRT and
// /RT /R (ISO 32000-1, 12.5.6.2) and come back under their markup, not as
// loose sticky notes. Real saver, real pdf.js reading of the saved bytes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';

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
const { statusReplyFromPdfAnnotation, applyStatusReplies } = await import('./loader/status-replies.js');
const { commentReplyFromPdfAnnotation, applyCommentReplies } = await import('./loader/comment-replies.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { markupReplies } = await import('../annotations/markup-replies.js');
const { applyStatusChange, statusHistory, parseStatusLines } = await import('../annotations/markup-status.js');
const { readMarkupStatusSet } = await import('./markup-status-set.js');

async function save(bytes, annotations, extra = {}) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  state.documents = [{ id: 'replies-roundtrip', filePath: 'C:/replies/input.pdf', pdfDoc: {},
    annotations: annotations.map(a => JSON.parse(JSON.stringify(a))), pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [], ...extra }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/replies/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved);
  return saved;
}

// The loader's page conversion (loader.js _convertAndPushAnnotations) for
// statuses, replies and markups.
async function reopen(bytes) {
  const pdfLibDoc = await PDFDocument.load(bytes.slice());
  const colors = await extractAnnotationColors(1, pdfLibDoc);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  const annotations = [];
  const raw = [];
  try {
    const page = await reader.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const byPdfId = new Map();
    const statuses = [];
    const replies = [];
    for (const annot of await page.getAnnotations()) {
      raw.push(annot);
      const status = statusReplyFromPdfAnnotation(annot);
      if (status) { statuses.push(status); continue; }
      const reply = commentReplyFromPdfAnnotation(annot);
      if (reply) { replies.push({ ...reply, annot }); continue; }
      const model = await convertPdfAnnotation(annot, 1, viewport, new Map(), colors);
      if (!model) continue;
      byPdfId.set(annot.id, model);
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
  return { annotations, raw, pdfLibDoc };
}

function blank() {
  const source = PDFDocument.create().then(async doc => { doc.addPage([595, 842]); return doc.save(); });
  return source;
}

test('replies on a box survive save/reopen as a thread, in order, without extra notes', async () => {
  const box = createAnnotation({ type: 'box', page: 1, x: 100, y: 100, width: 120, height: 80,
    color: '#e11d48', strokeColor: '#e11d48', author: 'Reviewer', subject: 'Clash' });
  box.status = 'accepted';
  box.statusBy = 'Lead';
  box.statusAt = '2026-10-03T09:00:00.000Z';
  box.replies = [
    { id: 'b', author: 'Site', text: 'Moved 50 mm, see sketch', createdAt: '2026-10-02T10:00:00.000Z' },
    { id: 'a', author: 'Architect', text: 'Ølkjeller, please check', createdAt: '2026-10-01T08:30:00.000Z' },
    { id: 'empty', author: 'User', text: '', createdAt: '2026-10-01T09:00:00.000Z' },
  ];
  const firstBytes = await save(await blank(), [box]);
  const first = await reopen(firstBytes);
  assert.equal(first.annotations.length, 1, 'replies are not loose notes');
  const [loaded] = first.annotations;
  assert.equal(loaded.type, 'box');
  assert.equal(loaded.status, 'accepted');
  assert.deepEqual(markupReplies(loaded).map(r => [r.author, r.text, r.createdAt]), [
    ['Architect', 'Ølkjeller, please check', '2026-10-01T08:30:00.000Z'],
    ['Site', 'Moved 50 mm, see sketch', '2026-10-02T10:00:00.000Z'],
  ]);
  const replyDicts = first.raw.filter(a => a.inReplyTo && !a.state);
  assert.equal(replyDicts.length, 2);
  for (const r of replyDicts) {
    assert.equal(r.subtype, 'Text');
    assert.equal(r.replyType, 'R');
    assert.equal(r.inReplyTo, first.raw.find(a => a.subtype === 'Square').id);
  }
  // A second save rewrites the thread instead of adding to it.
  const second = await reopen(await save(firstBytes, first.annotations));
  assert.equal(second.annotations.length, 1);
  assert.equal(markupReplies(second.annotations[0]).length, 2);
  assert.equal(second.raw.filter(a => a.inReplyTo && !a.state).length, 2);
});

test('a reply written by another PDF program joins its markup; a reply to a reply joins the same thread', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const ctx = doc.context;
  const square = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [50, 50, 200, 150],
    C: [1, 0, 0], T: PDFHexString.fromText('Designer'), Contents: PDFHexString.fromText('Door swing') }));
  const reply = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70],
    T: PDFHexString.fromText('Checker'), Contents: PDFHexString.fromText('Agreed'),
    CreationDate: PDFString.of('D:20261005120000Z') });
  reply.set(PDFName.of('IRT'), square);
  const replyRef = ctx.register(reply);
  const nested = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [50, 50, 70, 70],
    T: PDFHexString.fromText('Designer'), Contents: PDFHexString.fromText('Thanks'),
    CreationDate: PDFString.of('D:20261006120000Z') });
  nested.set(PDFName.of('IRT'), replyRef);
  nested.set(PDFName.of('RT'), PDFName.of('R'));
  const orphan = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 300, 320, 320],
    T: PDFHexString.fromText('Someone'), Contents: PDFHexString.fromText('Loose note') });
  orphan.set(PDFName.of('IRT'), ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 1, 1] })));
  page.node.set(PDFName.of('Annots'), ctx.obj([square, replyRef, ctx.register(nested), ctx.register(orphan)]));
  const { annotations } = await reopen(await doc.save());
  const box = annotations.find(a => a.type === 'box');
  assert.ok(box);
  assert.deepEqual(markupReplies(box).map(r => `${r.author}: ${r.text}`), ['Checker: Agreed', 'Designer: Thanks']);
  assert.equal(annotations.length, 2, 'a reply to a markup OcuDraw does not read stays a note');
  assert.equal(annotations.find(a => a !== box).type, 'comment');
});

test('every status change is saved as a review-status reply and comes back as the status history', async () => {
  const box = createAnnotation({ type: 'box', page: 1, x: 40, y: 40, width: 60, height: 60,
    color: '#000000', strokeColor: '#000000', author: 'Reviewer' });
  applyStatusChange(box, 'accepted', 'Bo', '2026-10-01T10:00:00.000Z');
  applyStatusChange(box, 'rejected', 'Cy', '2026-10-02T10:00:00.000Z');
  applyStatusChange(box, 'completed', 'Bo', '2026-10-03T10:00:00.000Z');
  const set = parseStatusLines('QA', 'Accepted #22c55e\nRejected #ef4444\nCompleted #3b82f6\nNeeds RFI #aa00aa');
  const bytes = await save(await blank(), [box], { markupStatusSet: set });
  const first = await reopen(bytes);
  const states = first.raw.filter(a => a.state);
  assert.deepEqual(states.map(a => [a.state, a.stateModel, a.titleObj.str]),
    [['Accepted', 'Review', 'Bo'], ['Rejected', 'Review', 'Cy'], ['Completed', 'Review', 'Bo']]);
  const [loaded] = first.annotations;
  assert.equal(first.annotations.length, 1);
  assert.equal(loaded.status, 'completed');
  assert.deepEqual(statusHistory(loaded).map(e => `${e.state}:${e.author}:${e.date}`), [
    'accepted:Bo:2026-10-01T10:00:00.000Z', 'rejected:Cy:2026-10-02T10:00:00.000Z', 'completed:Bo:2026-10-03T10:00:00.000Z']);
  assert.deepEqual(readMarkupStatusSet(first.pdfLibDoc), set, 'the status set travels in the PDF');
  // Saving again neither loses nor doubles the history, and a custom status
  // keeps its own spelling in /State.
  applyStatusChange(loaded, 'needs rfi', 'Dee', '2026-10-04T10:00:00.000Z');
  const second = await reopen(await save(bytes, first.annotations, { markupStatusSet: set }));
  assert.deepEqual(second.raw.filter(a => a.state).map(a => a.state), ['Accepted', 'Rejected', 'Completed', 'Needs RFI']);
  assert.equal(second.annotations[0].status, 'needs rfi');
  // Resetting to the default set removes it from the PDF.
  const third = await reopen(await save(bytes, second.annotations, { markupStatusSet: false }));
  assert.equal(readMarkupStatusSet(third.pdfLibDoc), null);
});

test('a status from an older file (no history) is still written once', async () => {
  const box = createAnnotation({ type: 'box', page: 1, x: 40, y: 40, width: 60, height: 60,
    color: '#000000', strokeColor: '#000000' });
  box.status = 'accepted';
  const { raw, annotations } = await reopen(await save(await blank(), [box]));
  assert.deepEqual(raw.filter(a => a.state).map(a => a.state), ['Accepted']);
  assert.equal(annotations[0].status, 'accepted');
});
