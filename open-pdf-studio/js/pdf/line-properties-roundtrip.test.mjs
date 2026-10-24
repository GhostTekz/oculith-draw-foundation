import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const { state } = await import('../core/state.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');
const { storeShowProperties, updateAnnotProp } = await import('../solid/stores/propertiesStore.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');

async function save(bytes, annotations) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  state.documents = [{ id: 'line-properties-test', filePath: 'C:/line/input.pdf', pdfDoc: {},
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    savedUndoStackLength: 0, pageRotations: {}, _annotationPagesReady: new Set([1]),
    textEdits: [], watermarks: [], bookmarks: [] }];
  state.activeDocumentIndex = 0;
  return async () => {
    assert.equal(await savePDF('C:/line/output.pdf', { zonderHandtekeningVraag: true }), true);
    assert.ok(saved, 'the saver wrote PDF bytes');
    return saved;
  };
}

async function reopen(bytes) {
  const pdfLibDoc = await PDFDocument.load(bytes.slice());
  const colors = await extractAnnotationColors(1, pdfLibDoc);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  try {
    const page = await reader.getPage(1);
    const models = [];
    for (const annotation of await page.getAnnotations()) {
      const model = await convertPdfAnnotation(annotation, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (model) models.push(model);
    }
    return { models, pdfLibDoc };
  } finally {
    await task.destroy();
  }
}

test('edited line color, width, opacity, and lock survive PDF byte roundtrip', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const line = createAnnotation({ type: 'line', page: 1,
    startX: 90, startY: 130, endX: 245, endY: 205,
    color: '#000000', strokeColor: '#000000', lineWidth: 2, opacity: 1, locked: false });
  const write = await save(await source.save(), [line]);
  storeShowProperties(state.documents[0].annotations[0]);
  updateAnnotProp('strokeColor', '#2a70c5');
  updateAnnotProp('lineWidth', '4.25');
  updateAnnotProp('opacity', '35');
  updateAnnotProp('locked', true);
  assert.equal(line.strokeColor, '#2a70c5', 'the properties model changed the visible line color');
  assert.equal(line.lineWidth, 4.25);
  assert.equal(line.opacity, 0.35);
  assert.equal(line.locked, true);

  const bytes = await write();
  const { models, pdfLibDoc } = await reopen(bytes);
  const restored = models.filter(a => a.type === 'line');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].strokeColor.toLowerCase(), '#2a70c5');
  assert.equal(restored[0].lineWidth, 4.25);
  assert.ok(Math.abs(restored[0].opacity - 0.35) < 0.001);
  assert.equal(restored[0].locked, true);

  const raw = pdfLibDoc.context.lookup(pdfLibDoc.getPages()[0].node.get(PDFName.of('Annots')));
  const lineDict = raw.asArray().map(ref => pdfLibDoc.context.lookup(ref))
    .find(dict => dict.get(PDFName.of('Subtype'))?.toString() === '/Line');
  assert.ok(lineDict, 'the PDF stores a native Line annotation');
  const rgb = lineDict.lookup(PDFName.of('C')).asArray().map(channel => channel.asNumber());
  for (const [index, byte] of [0x2a, 0x70, 0xc5].entries()) {
    assert.ok(Math.abs(rgb[index] - byte / 255) < 0.001, `PDF stroke channel ${index}`);
  }
  assert.ok(Math.abs(lineDict.get(PDFName.of('CA')).asNumber() - 0.35) < 0.001,
    'PDF stroke opacity is present');
  assert.equal(lineDict.get(PDFName.of('F')).asNumber() & 128, 128, 'PDF Locked flag is present');
  assert.equal(lineDict.get(PDFName.of('BS')).lookup(PDFName.of('W')).asNumber(), 4.25);
});

test('an untouched line retains its creator defaults after save and reopen', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const write = await save(await source.save(), []);
  const line = createAnnotationFromTool('line', 70, 100, 220, 150);
  state.documents[0].annotations.push(line);
  const { models } = await reopen(await write());
  const restored = models.filter(a => a.type === 'line');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].strokeColor.toLowerCase(), (line.strokeColor || line.color).toLowerCase());
  assert.equal(restored[0].lineWidth, line.lineWidth);
  assert.equal(restored[0].opacity, line.opacity);
  assert.equal(restored[0].locked, false);
});
