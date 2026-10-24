import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

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
const { leesAnnotatieLagen, pasGelezenLagenToe } = await import('./saver/annotatie-lagen.js');
const { addLayer, getLayers, isLayerHidden, setCurrentLayer, currentLayerId, DEFAULT_LAYER_ID } = await import('../annotations/annotatie-lagen.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');

async function save(bytes, model) {
  let saved;
  // A tool-created model can be the live Solid mutable document. Snapshot its
  // arrays before replacing state.documents, which reconciles the old array.
  const annotations = model.annotations.map(annotation => ({ ...annotation }));
  const annotationLayers = model.annotationLayers?.map(layer => ({ ...layer }));
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  state.documents = [{ id: 'markup-layer-roundtrip', filePath: 'C:/layers/input.pdf', pdfDoc: {},
    annotations, annotationLayers,
    currentLayerId: model.currentLayerId, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [] }];
  state.activeDocumentIndex = 0;
  assert.equal(state.documents[0].annotations.length, annotations.length);
  assert.equal(await savePDF('C:/layers/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved);
  return saved;
}

async function reopen(bytes) {
  const pdfLibDoc = await PDFDocument.load(bytes.slice());
  const layers = leesAnnotatieLagen(pdfLibDoc);
  const colors = await extractAnnotationColors(1, pdfLibDoc);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  const annotations = [];
  try {
    const page = await reader.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    for (const annotation of await page.getAnnotations()) {
      const model = await convertPdfAnnotation(annotation, 1, viewport, new Map(), colors);
      if (model) annotations.push(model);
    }
  } finally {
    await task.destroy();
  }
  const doc = { annotations };
  assert.equal(pasGelezenLagenToe(doc, layers), true);
  return { doc, pdfLibDoc };
}

test('a hidden markup layer and its line survive PDF save/reopen without altering native OCGs', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const context = source.context;
  const nativeRef = context.register(context.obj({ Type: 'OCG', Name: 'CAD Grid' }));
  source.catalog.set(PDFName.of('OCProperties'), context.obj({
    OCGs: [nativeRef], D: { Order: [nativeRef], OFF: [nativeRef] },
  }));
  const model = { annotations: [] };
  const hidden = addLayer(model, { name: 'Review hold', visible: false }).layer;
  assert.ok(hidden);
  model.annotations.push(createAnnotation({ type: 'line', page: 1,
    startX: 100, startY: 120, endX: 200, endY: 180,
    color: '#e11d48', strokeColor: '#e11d48', lineWidth: 2, layer: hidden.id }));
  const firstBytes = await save(await source.save(), model);
  const { doc, pdfLibDoc } = await reopen(firstBytes);
  const restoredLayer = getLayers(doc).find(layer => layer.id === hidden.id);
  assert.equal(restoredLayer?.visible, false);
  assert.equal(doc.annotations.length, 1);
  assert.equal(doc.annotations[0].type, 'line');
  assert.equal(doc.annotations[0].layer, hidden.id);
  assert.equal(isLayerHidden(doc, doc.annotations[0]), true);
  const oc = pdfLibDoc.catalog.lookup(PDFName.of('OCProperties'));
  const ocgs = pdfLibDoc.context.lookup(oc.get(PDFName.of('OCGs'))).asArray();
  assert.equal(pdfLibDoc.context.lookup(ocgs[0]).get(PDFName.of('Name')).decodeText(), 'CAD Grid');
  const off = pdfLibDoc.context.lookup(pdfLibDoc.context.lookup(oc.get(PDFName.of('D'))).get(PDFName.of('OFF'))).asArray();
  assert.ok(off.includes(ocgs[0]), 'the CAD group remains hidden');
  const second = await reopen(await save(firstBytes, doc));
  assert.equal(second.doc.annotations.length, 1, 'second save has no duplicate markup');
  assert.equal(getLayers(second.doc).find(layer => layer.id === hidden.id)?.visible, false);
  assert.equal(second.doc.annotations[0].layer, hidden.id);
});

test('a new line follows the active layer, and later layer changes do not move it', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const model = { annotations: [], currentPage: 1, scale: 1 };
  const selected = addLayer(model, { name: 'Reviewer' }).layer;
  assert.equal(setCurrentLayer(model, selected.id).ok, true);
  state.documents = [model];
  state.activeDocumentIndex = 0;
  const first = createAnnotationFromTool('line', 80, 90, 130, 140, null);
  assert.ok(first);
  assert.equal(first.type, 'line');
  assert.equal(first.page, 1);
  assert.equal(first.layer, selected.id);
  model.annotations.push(first);
  assert.equal(setCurrentLayer(model, DEFAULT_LAYER_ID).ok, true);
  const second = createAnnotationFromTool('line', 180, 190, 230, 240, null);
  assert.ok(second);
  assert.equal(second.type, 'line');
  assert.equal(second.page, 1);
  assert.equal(second.layer, undefined);
  model.annotations.push(second);
  assert.equal(first.layer, selected.id, 'switching the active layer leaves old markups alone');
  const saved = await save(await source.save(), model);
  const raw = await PDFDocument.load(saved);
  const rawAnnots = raw.context.lookup(raw.getPages()[0].node.get(PDFName.of('Annots')));
  assert.equal(rawAnnots?.size(), 2, 'the saver wrote both tool-created lines');
  const { doc } = await reopen(saved);
  assert.equal(doc.annotations.length, 2);
  const byStart = [...doc.annotations].sort((a, b) => a.startX - b.startX);
  assert.equal(byStart[0].layer, selected.id);
  assert.equal(byStart[1].layer, undefined);
  assert.equal(currentLayerId(doc), DEFAULT_LAYER_ID);
});
