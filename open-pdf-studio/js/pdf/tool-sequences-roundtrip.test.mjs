// Tool Chest sequences through a real PDF: placements with a sequenced tool
// stamp D-01, D-02 into the markups, the saver writes the next value into the
// catalog (OPS_ToolSequences), and a reopened document continues at D-03.
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
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key) };
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');
const presets = await import('../tools/tool-chest-presets.js');
const { readToolSequencesFromCatalog, TOOL_SEQUENCES_CATALOG_KEY } = await import('./saver/tool-sequences-catalog.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const { decodePdfTextObject } = await import('./saver/pdf-text.js');

function openDoc(id, annotations, toolSequences) {
  state.documents = [{ id, filePath: `C:/seq/${id}.pdf`, pdfDoc: {}, currentPage: 1, annotations,
    pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
    ...(toolSequences ? { toolSequences } : {}) }];
  state.activeDocumentIndex = 0;
  return state.documents[0];
}

async function save(bytes) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/seq/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
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
    return { models, counters: readToolSequencesFromCatalog(pdfLibDoc), pdfLibDoc };
  } finally {
    await task.destroy();
  }
}

test('sequenced textbox and count tools number placements and a reopened PDF continues', async () => {
  const sequence = { prefix: 'D-', suffix: '', start: 1, step: 1, digits: 2 };
  const textTool = presets.saveToolPreset({ type: 'textbox', strokeColor: '#153558', textColor: '#153558',
    fontSize: 12, x: 0, y: 0, width: 120, height: 30, text: 'source text' }, 'Door tag');
  const countTool = presets.saveToolPreset({ type: 'count', markerStyle: 'dot', color: '#a81d48',
    strokeColor: '#a81d48', x: 1, y: 1, number: 9 }, 'Door count');
  assert.ok(presets.setToolPresetSequence(textTool.id, sequence));
  assert.ok(presets.setToolPresetSequence(countTool.id, sequence));
  assert.equal(presets.setToolPresetSequence(textTool.id, { ...sequence, digits: 0 }), null, 'invalid pattern refused');

  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const doc = openDoc('first', []);
  presets.activateToolPreset(textTool.id);
  const first = createAnnotationFromTool('textbox', 100, 100, 220, 130, null);
  presets.activateToolPreset(countTool.id);
  const second = createAnnotationFromTool('count', 300, 300, 300, 300, null);
  presets.clearActiveToolPreset();
  const plain = createAnnotationFromTool('textbox', 100, 400, 220, 430, null);
  assert.equal(first.text, 'D-01');
  assert.equal(first.subject, 'D-01');
  assert.equal(second.subject, 'D-02', 'tools with the same prefix share the document counter');
  assert.equal(plain.subject, '', 'a placement without the sequenced tool takes no label');
  doc.annotations.push(first, second, plain);

  const bytes = await save(await source.save());
  const raw = (await PDFDocument.load(bytes)).catalog.lookup(PDFName.of(TOOL_SEQUENCES_CATALOG_KEY));
  assert.deepEqual(JSON.parse(decodePdfTextObject(raw)), [{ prefix: 'D-', suffix: '', next: 3 }]);
  const reopened = await reopen(bytes);
  const texts = reopened.models.filter(a => a.type === 'textbox').map(a => a.text).sort();
  assert.ok(texts.includes('D-01'), `textbox text ${JSON.stringify(texts)}`);
  const count = reopened.models.find(a => a.type === 'count');
  assert.equal(count.subject, 'D-02', 'the count label is its PDF comment');

  // Reopen: the loader puts the catalog counters on the document.
  const again = openDoc('reopened', reopened.models, reopened.counters);
  presets.activateToolPreset(textTool.id);
  const third = createAnnotationFromTool('textbox', 100, 500, 220, 530, null);
  assert.equal(third.text, 'D-03', 'numbering continues after reopen');
  again.annotations.push(third);

  // Reset in the tool settings: next value back to start for this document.
  const { setNextSequenceValue } = await import('../tools/tool-sequences.js');
  setNextSequenceValue(again, sequence, 1);
  assert.equal(createAnnotationFromTool('textbox', 10, 10, 120, 40, null).text, 'D-01');

  const secondSave = await save(bytes);
  assert.deepEqual((await reopen(secondSave)).counters, { 'D-\u0001': 2 });
  presets.clearActiveToolPreset();
});

test('a document whose counters were never read keeps the catalog entry on save', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  openDoc('with-counters', [], { 'W\u0001': 12 });
  const withCounters = await save(await source.save());
  openDoc('not-read', []);
  const untouched = await save(withCounters);
  assert.deepEqual((await reopen(untouched)).counters, { 'W\u0001': 12 });
  openDoc('cleared', [], {});
  assert.deepEqual((await reopen(await save(withCounters))).counters, {}, 'an empty map removes the entry');
});
