// WP2 Capture: photos on a markup and the File Attachment markup survive
// save → reopen with real PDF bytes (saver.js + pdf.js + the converter), are
// visible to other readers (/Names /EmbeddedFiles, a /FileAttachment with an
// appearance) and do not pile up over repeated saves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

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
const { loadFileAttachmentContents } = await import('./loader/capture-load.js');
const { markupCsv } = await import('../annotations/markup-csv.js');
const { makePhoto, makeAttachedFile, dataUrlToBytes, attachmentCount, FILE_ATTACHMENT_ICON } = await import('../annotations/capture.js');
const { exifJpeg, tinyPng } = await import('../annotations/capture.testhulp.mjs');

function openDocument(annotations, ready = [1]) {
  state.documents = [{ id: `capture-rt-${Math.random()}`, filePath: 'C:/capture/input.pdf', pdfDoc: {},
    currentPage: 1, annotations, pageRotations: {}, _annotationPagesReady: new Set(ready), textEdits: [] }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

async function save(bytes, annotations, ready) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  openDocument(annotations, ready);
  assert.equal(await savePDF('C:/capture/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return new Uint8Array(saved);
}

async function withPdfjs(bytes, fn) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try { return await fn(doc); } finally { await task.destroy(); }
}

async function reopen(bytes, pageNum = 1) {
  return withPdfjs(bytes, async (doc) => {
    const page = await doc.getPage(pageNum);
    const pdfLibDoc = await PDFDocument.load(bytes.slice());
    const colors = await extractAnnotationColors(pageNum, pdfLibDoc);
    const models = [];
    const annots = await page.getAnnotations();
    await loadFileAttachmentContents(annots, doc);
    for (const annotation of annots) {
      const model = await convertPdfAnnotation(annotation, pageNum, page.getViewport({ scale: 1 }), new Map(), colors);
      if (model) models.push(model);
    }
    return models;
  });
}

async function blankPdf(pages = 1) {
  const source = await PDFDocument.create();
  for (let i = 0; i < pages; i++) source.addPage([612, 792]);
  return source.save();
}

const PDF_SPEC = new TextEncoder().encode('%PDF-1.4 spec sheet (not a real pdf) \\ ( unbalanced');

async function markups() {
  const jpeg = exifJpeg('2026:10:01 09:15:30');
  const png = await tinyPng();
  const cloud = createAnnotation({ type: 'cloud', page: 1, x: 120, y: 90, width: 240, height: 160,
    color: '#ff0000', strokeColor: '#ff0000', lineWidth: 2, subject: 'Leak at riser' });
  cloud.capturePhotos = [
    makePhoto(jpeg, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', width: 4032, height: 3024, date: '2026-10-01T09:15:30' }),
    makePhoto(png, { name: 'sketch (north.png', mimeType: 'image/png', width: 2, height: 2 }),
  ];
  const pin = createAnnotation({ type: 'comment', page: 1, x: 400, y: 300, width: 24, height: 24,
    icon: FILE_ATTACHMENT_ICON, color: '#2563EB', text: '' });
  pin.attachedFile = makeAttachedFile(PDF_SPEC, 'Valve spec (rev B).pdf');
  return { cloud, pin, jpeg, png };
}

function embeddedNames(pdfLibDoc) {
  const names = pdfLibDoc.catalog.lookup(PDFName.of('Names'));
  const tree = names?.lookup(PDFName.of('EmbeddedFiles'));
  const arr = tree?.lookup(PDFName.of('Names'));
  if (!(arr instanceof PDFArray)) return [];
  const out = [];
  for (let i = 0; i < arr.size(); i += 2) out.push(arr.lookup(i).decodeText());
  return out;
}

const countOf = (haystack, needle) => {
  const h = Buffer.from(haystack);
  let n = 0;
  for (let at = h.indexOf(needle); at >= 0; at = h.indexOf(needle, at + 1)) n++;
  return n;
};

test('two photos on a cloud and a File Attachment survive save and reopen', async () => {
  const { cloud, pin, jpeg, png } = await markups();
  const first = await save(await blankPdf(), [cloud, pin]);
  const models = await reopen(first);

  const cloudBack = models.find(m => m.type === 'cloud');
  assert.ok(cloudBack, 'the cloud reopens');
  assert.equal(cloudBack.capturePhotos.length, 2);
  const [p1, p2] = cloudBack.capturePhotos;
  assert.equal(p1.name, 'IMG_0001.jpg');
  assert.equal(p1.mimeType, 'image/jpeg');
  assert.equal(p1.date, '2026-10-01T09:15:30', 'EXIF capture date kept');
  assert.equal(p1.width, 4032);
  assert.equal(p1.id, cloud.capturePhotos[0].id);
  assert.deepEqual(dataUrlToBytes(p1.dataUrl), jpeg, 'photo bytes unchanged');
  assert.equal(p2.name, 'sketch (north.png', 'a name with an unbalanced parenthesis survives');
  assert.equal(p2.mimeType, 'image/png');
  assert.deepEqual(dataUrlToBytes(p2.dataUrl), png);

  const pinBack = models.find(m => m.attachedFile);
  assert.ok(pinBack, 'the File Attachment reopens');
  assert.equal(pinBack.type, 'comment');
  assert.equal(pinBack.icon, FILE_ATTACHMENT_ICON);
  assert.equal(pinBack.attachedFile.name, 'Valve spec (rev B).pdf');
  assert.equal(pinBack.attachedFile.mimeType, 'application/pdf');
  assert.deepEqual(dataUrlToBytes(pinBack.attachedFile.dataUrl), PDF_SPEC);
  assert.ok(Math.abs(pinBack.x - 400) < 0.01 && Math.abs(pinBack.y - 300) < 0.01, 'pin stays in place');
  assert.equal(attachmentCount(pinBack), 1);

  const csv = markupCsv(models);
  const header = csv.split('\r\n')[0];
  assert.match(header, /"Attachments"$/u);
  assert.match(csv, /"IMG_0001\.jpg; sketch \(north\.png"/u);
  assert.match(csv, /"Valve spec \(rev B\)\.pdf"/u);
});

test('other readers see the photos as embedded files and the push pin with its file', async () => {
  const { cloud, pin } = await markups();
  const bytes = await save(await blankPdf(), [cloud, pin]);
  await withPdfjs(bytes, async (doc) => {
    const attachments = await doc.getAttachments();
    const files = [...(attachments instanceof Map ? attachments.values() : Object.values(attachments || {}))].map(a => a.filename).sort();
    assert.deepEqual(files, ['IMG_0001.jpg', 'sketch (north.png']);
    const annots = await (await doc.getPage(1)).getAnnotations();
    const fa = annots.find(a => a.subtype === 'FileAttachment');
    assert.ok(fa, 'a standard /FileAttachment annotation');
    assert.equal(fa.file.filename, 'Valve spec (rev B).pdf');
    assert.deepEqual(new Uint8Array(await doc.getAttachmentContent(fa.fileId)), PDF_SPEC);
    assert.equal(fa.name, 'PushPin');
  });
  const lib = await PDFDocument.load(bytes);
  const annots = lib.getPages()[0].node.lookup(PDFName.of('Annots'));
  const fa = annots.asArray().map(r => lib.context.lookup(r))
    .find(d => d.get(PDFName.of('Subtype'))?.toString() === '/FileAttachment');
  assert.ok(fa.get(PDFName.of('AP')), 'the pin has an appearance for other readers');
});

test('repeated saves neither duplicate nor keep old photo streams', async () => {
  const { cloud, pin } = await markups();
  const marker = Buffer.from('2026:10:01 09:15:30');
  const first = await save(await blankPdf(), [cloud, pin]);
  const second = await save(first, await reopen(first));
  const third = await save(second, await reopen(second));
  for (const bytes of [first, second, third]) {
    assert.equal(countOf(bytes, marker), 1, 'one copy of the JPEG');
    const lib = await PDFDocument.load(bytes);
    assert.equal(embeddedNames(lib).length, 2, 'two photos listed');
  }
  // (Old annotation dicts and their appearances are a separate, older matter;
  // the embedded file streams themselves must not pile up.)
  for (const bytes of [first, second, third]) {
    assert.equal(countOf(bytes, Buffer.from('/Type /EmbeddedFile')), 3, 'two photos and one attachment stream');
  }
  const spec = Buffer.from(PDF_SPEC);
  const models = await reopen(third);
  assert.deepEqual(dataUrlToBytes(models.find(m => m.attachedFile).attachedFile.dataUrl), new Uint8Array(spec));
  assert.equal(models.find(m => m.type === 'cloud').capturePhotos.length, 2);
});

test('removing a photo removes it from the file; other embedded files stay', async () => {
  const { cloud, pin } = await markups();
  const src = await PDFDocument.load(await blankPdf());
  await src.attach(new TextEncoder().encode('site notes'), 'notes.txt', { mimeType: 'text/plain' });
  const first = await save(await src.save(), [cloud, pin]);
  assert.deepEqual(embeddedNames(await PDFDocument.load(first)).length, 3);
  const models = await reopen(first);
  const c = models.find(m => m.type === 'cloud');
  c.capturePhotos = c.capturePhotos.slice(1);
  const withoutPin = models.filter(m => !m.attachedFile);
  const second = await save(first, withoutPin);
  assert.equal(countOf(second, Buffer.from('2026:10:01 09:15:30')), 0, 'removed photo stream is gone');
  assert.equal(countOf(second, Buffer.from('spec sheet (not a real pdf)')), 0, 'removed attachment stream is gone');
  await withPdfjs(second, async (doc) => {
    const files = [...((a) => (a instanceof Map ? a.values() : Object.values(a || {})))(await doc.getAttachments())].map(a => a.filename).sort();
    assert.deepEqual(files, ['notes.txt', 'sketch (north.png']);
  });
});

test('photos on a page that was not loaded stay in the file and its list', async () => {
  const { cloud } = await markups();
  cloud.page = 2;
  const first = await save(await blankPdf(2), [cloud], [1, 2]);
  // Page 2 not loaded this time: the file is the truth for it.
  const second = await save(first, [], [1]);
  assert.equal(embeddedNames(await PDFDocument.load(second)).length, 2);
  const back = (await reopen(second, 2)).find(m => m.type === 'cloud');
  assert.equal(back.capturePhotos.length, 2);
});

test('a PDF without capture data is not given an embedded files tree', async () => {
  const box = createAnnotation({ type: 'box', page: 1, x: 10, y: 10, width: 50, height: 40, color: '#000000' });
  const bytes = await save(await blankPdf(), [box]);
  const lib = await PDFDocument.load(bytes);
  assert.equal(lib.catalog.get(PDFName.of('Names')), undefined);
});
