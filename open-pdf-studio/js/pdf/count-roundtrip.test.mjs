import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { degrees, PDFDocument, PDFName } from 'pdf-lib';

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
const { decodePdfTextObject } = await import('./saver/pdf-text.js');

async function save(bytes, annotations) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  state.documents = [{ id: 'count-roundtrip', filePath: 'C:/count/input.pdf', pdfDoc: {},
    annotations, pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [] }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/count/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

async function rawCounts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const context = doc.context;
  const array = context.lookup(doc.getPages()[0].node.get(PDFName.of('Annots')));
  if (!array) return [];
  return array.asArray().map(ref => context.lookup(ref)).filter(dict =>
    dict.get(PDFName.of('Subtype'))?.toString() === '/Square' &&
    decodePdfTextObject(dict.get(PDFName.of('OPS_Subtype'))) === 'count');
}

async function reopen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const pdfLibDoc = await PDFDocument.load(bytes.slice());
    const colors = await extractAnnotationColors(1, pdfLibDoc);
    const models = [];
    for (const annotation of await page.getAnnotations()) {
      const model = await convertPdfAnnotation(annotation, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (model) models.push(model);
    }
    return models;
  } finally {
    await task.destroy();
  }
}

test('count category, number and marker position survive two PDF saves', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const model = createAnnotation({ type: 'count', page: 1, x: 143, y: 257,
    categoryId: 'doors-A', number: 12, markerStyle: 'dot', color: '#e11d48', opacity: 1 });
  const firstBytes = await save(await source.save(), [model]);
  const firstRaw = await rawCounts(firstBytes);
  assert.equal(firstRaw.length, 1, 'count annotation is stored as a PDF Square');
  assert.equal(decodePdfTextObject(firstRaw[0].get(PDFName.of('OPS_CountCategory'))), 'doors-A');
  assert.equal(firstRaw[0].get(PDFName.of('OPS_CountNumber'))?.asNumber(), 12);
  assert.ok(firstRaw[0].get(PDFName.of('AP')), 'other PDF viewers receive a visible appearance');
  const context = firstRaw[0].context;
  const appearance = context.lookup(firstRaw[0].get(PDFName.of('AP')));
  const normalAppearance = context.lookup(appearance.get(PDFName.of('N')));
  assert.ok(normalAppearance.getContents().length > 0, 'the appearance draws the marker');
  const first = (await reopen(firstBytes)).filter(a => a.type === 'count');
  assert.equal(first.length, 1);
  assert.equal(first[0].categoryId, 'doors-A');
  assert.equal(first[0].number, 12);
  assert.equal(first[0].page, 1);
  assert.ok(Math.abs(first[0].x - 143) < 0.01);
  assert.ok(Math.abs(first[0].y - 257) < 0.01);
  assert.equal(first[0].markerStyle, 'dot');
  const secondBytes = await save(firstBytes, first);
  assert.equal((await rawCounts(secondBytes)).length, 1, 'second save replaces the same count');
  const second = (await reopen(secondBytes)).filter(a => a.type === 'count');
  assert.equal(second.length, 1);
  assert.equal(second[0].categoryId, 'doors-A');
  assert.equal(second[0].number, 12);
  assert.ok(Math.abs(second[0].x - 143) < 0.01);
  assert.ok(Math.abs(second[0].y - 257) < 0.01);
});

test('count metadata and point position survive a rotated PDF page', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]).setRotation(degrees(90));
  const model = createAnnotation({ type: 'count', page: 1, x: 321, y: 217,
    categoryId: 'fixtures', number: 3, markerStyle: 'symbol',
    symbolId: 'fixture-marker', color: '#2277aa' });
  const bytes = await save(await source.save(), [model]);
  const loaded = (await reopen(bytes)).filter(a => a.type === 'count');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].categoryId, 'fixtures');
  assert.equal(loaded[0].number, 3);
  assert.equal(loaded[0].markerStyle, 'symbol');
  assert.equal(loaded[0].symbolId, 'fixture-marker');
  assert.ok(Math.abs(loaded[0].x - 321) < 0.01);
  assert.ok(Math.abs(loaded[0].y - 217) < 0.01);
});
