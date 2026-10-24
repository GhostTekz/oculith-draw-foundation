// Tool Chest symbol count presets: saved from the form or a selected symbol
// count, placed with the count tool in their own category with correct
// numbers, saved twice to real PDF bytes, and numbering continues in a new
// session on the reopened file.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();

const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };

const { state } = await import('../core/state.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { createAnnotationFromTool } = await import('../tools/annotation-creators.js');
const tools = await import('../tools/tool-chest-presets.js');
const { countPresetCategoryId, cleanCountStyle } = await import('../tools/tool-preset-count.js');
const { countCategories, addCountCategory, removeCountCategory, countPresetSource } = await import('../solid/stores/countStore.js');
const { savePDF } = await import('./saver.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');

function openDocument(annotations = []) {
  state.documents = [{ id: `scp-${Math.random()}`, filePath: 'C:/scp/input.pdf', pdfDoc: {}, currentPage: 1,
    annotations, measureScale: null, pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [] }];
  state.activeDocumentIndex = 0;
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
  assert.equal(await savePDF('C:/scp/output.pdf', { zonderHandtekeningVraag: true }), true);
  return saved;
}

async function reopen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const colors = await extractAnnotationColors(1, await PDFDocument.load(bytes.slice()));
    const models = [];
    for (const annotation of await page.getAnnotations()) {
      const model = await convertPdfAnnotation(annotation, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (model) models.push(model);
    }
    return models.filter(m => m.type === 'count').sort((a, b) => a.x - b.x);
  } finally {
    await task.destroy();
  }
}

async function appearances(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  return ctx.lookup(doc.getPages()[0].node.get(PDFName.of('Annots'))).asArray().map(ref => {
    const n = ctx.lookup(ctx.lookup(ctx.lookup(ref).get(PDFName.of('AP'))).get(PDFName.of('N')));
    return n instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(n).decode()) : '';
  });
}

function place(x, y) {
  const doc = state.documents[state.activeDocumentIndex];
  const ann = createAnnotationFromTool('count', x, y, x, y, {});
  doc.annotations.push(ann);
  return ann;
}

test('a symbol count preset keeps symbol, size, colour, numbering and category, never document data', () => {
  const source = { type: 'count', id: 'private-id', page: 4, x: 1, y: 2, number: 31, categoryId: 'doc-cat',
    markerStyle: 'symbol', symbolId: 'count.receptacle', symbolSize: 26, showNumber: false,
    color: '#0e7490', strokeColor: '#0e7490', opacity: 0.8, author: 'PRIVATE', subject: 'PRIVATE NOTE' };
  assert.equal(tools.canSaveToolPreset(source), true);
  assert.deepEqual(cleanCountStyle(source), { color: '#0e7490', strokeColor: '#0e7490', opacity: 0.8,
    markerStyle: 'symbol', symbolId: 'count.receptacle', symbolSize: 26, showNumber: false, countCategory: 'Receptacle' });
  assert.equal(tools.canSaveToolPreset({ ...source, symbolId: 'not-a-count-symbol' }), false,
    'a symbol the saver cannot draw is not offered');
  const saved = tools.saveToolPreset({ ...source, countCategory: 'Outlets L2' }, 'Outlets');
  assert.equal(saved.style.countCategory, 'Outlets L2');
  const stored = values.get('oculith-tool-chest-presets-v1');
  for (const secret of ['private-id', 'doc-cat', 'PRIVATE']) assert.equal(stored.includes(secret), false);
  assert.equal(countPresetCategoryId('Outlets L2'), countPresetCategoryId('  outlets l2 '), 'names match without case or outer spaces');
  assert.notEqual(countPresetCategoryId('Outlets L2'), countPresetCategoryId('Outlets L3'));
  tools.deleteToolPreset(saved.id);
});

test('a selected symbol count saves with its category name (Tool Chest Add Selected, context menu)', () => {
  const category = { id: addCountCategory('Panel boards', '#0e7490', 'symbol', 'count.receptacle') };
  const markup = { type: 'count', id: 'sel', page: 1, x: 5, y: 5, categoryId: category.id, markerStyle: 'symbol',
    symbolId: 'count.receptacle', symbolSize: 20, color: '#0e7490' };
  assert.equal(countPresetSource(markup).countCategory, 'Panel boards');
  assert.equal(markup.countCategory, undefined, 'the markup itself is not changed');
  const dot = { type: 'count', categoryId: category.id, markerStyle: 'dot' };
  assert.equal(countPresetSource(dot), dot);
  const saved = tools.saveToolPreset(countPresetSource(markup), 'Panels');
  assert.equal(saved.style.countCategory, 'Panel boards');
  tools.deleteToolPreset(saved.id);
  removeCountCategory(category.id);
});

test('a symbol count preset placed from the Tool Chest numbers in its category and survives two saves', async () => {
  const preset = tools.saveSymbolCountPreset({ symbolId: 'count.light', symbolSize: 28, color: '#7c3aed',
    countCategory: 'Light fixtures', showNumber: true }, 'Lights');
  assert.ok(preset, 'the form saves a preset');
  assert.equal(preset.tool, 'count');
  const categoryId = countPresetCategoryId('Light fixtures');

  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const doc = openDocument([
    // A dot count in another category is not part of this numbering.
    createAnnotation({ type: 'count', page: 1, x: 20, y: 20, categoryId: 'deuren', number: 1, markerStyle: 'dot', color: '#e11d48' }),
  ]);
  tools.activateToolPreset(preset.id);
  const placed = [place(100, 200), place(160, 200), place(220, 200)];
  assert.deepEqual(placed.map(a => [a.categoryId, a.number, a.markerStyle, a.symbolId, a.symbolSize, a.color]),
    [1, 2, 3].map(n => [categoryId, n, 'symbol', 'count.light', 28, '#7c3aed']));
  assert.ok(countCategories().some(c => c.id === categoryId && c.name === 'Light fixtures' && c.symbolId === 'count.light'));

  const first = await save(await source.save(), doc.annotations);
  const aps = await appearances(first);
  assert.equal(aps.filter(ap => /\(3\) Tj/u.test(ap) && !/\bDo\b/u.test(ap)).length, 1, 'vector appearance with the number');
  const reopened = await reopen(first);
  const second = await save(first, reopened);
  const again = (await reopen(second)).filter(a => a.categoryId === categoryId);
  assert.deepEqual(again.map(a => [a.number, a.symbolId, a.symbolSize, Math.round(a.x), Math.round(a.y)]),
    [[1, 'count.light', 28, 100, 200], [2, 'count.light', 28, 160, 200], [3, 'count.light', 28, 220, 200]]);

  // Next session: the reopened file continues at 4 in the same category.
  openDocument(await reopen(second));
  const fresh = await import(`../tools/tool-chest-presets.js?session=${Date.now()}`);
  assert.equal(countPresetCategoryId('Light fixtures'), categoryId, 'the category id does not depend on the session');
  const next = place(280, 200);
  assert.equal(next.categoryId, categoryId);
  assert.equal(next.number, 4);
  assert.ok(fresh.getToolChestPresets().some(p => p.id === preset.id && p.style.symbolId === 'count.light'),
    'the preset survives a reload');
  tools.clearActiveToolPreset();
  const plain = place(300, 300);
  assert.notEqual(plain.categoryId, categoryId, 'without the preset the active category is used');
});
