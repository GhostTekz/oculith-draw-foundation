// Extract Pages keeps the markup layers: a page copied out of a drawing whose
// markups the real saver put on layers is a PDF whose markups are still on
// those layers, for this app and for other readers (/OCProperties, read here
// through pdf.js), with the hidden state and the app's own layer list. The
// layers of pages left behind do not come along, and a markup's /P does not
// pull the source's page tree into the extract.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFDict, PDFHexString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { leesAnnotatieLagen } = await import('./saver/annotatie-lagen.js');
const { addLayer } = await import('../annotations/annotatie-lagen.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { extractPdfLibPages } = await import('./extract-pages-core.js');

const N = (s) => PDFName.of(s);

async function save(bytes, model) {
  let saved;
  const annotations = model.annotations.map(annotation => ({ ...annotation }));
  const annotationLayers = model.annotationLayers?.map(layer => ({ ...layer }));
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  state.documents = [{ id: 'extract-layers', filePath: 'C:/layers/input.pdf', pdfDoc: {},
    annotations, annotationLayers, currentLayerId: model.currentLayerId, pageRotations: {},
    _annotationPagesReady: new Set([1, 2]), textEdits: [] }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/layers/output.pdf', { zonderHandtekeningVraag: true }), true);
  return saved;
}

const line = (page, layer, x) => createAnnotation({ type: 'line', page,
  startX: x, startY: 120, endX: x + 100, endY: 180,
  color: '#e11d48', strokeColor: '#e11d48', lineWidth: 2, layer });

async function drawing() {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  source.addPage([595, 842]);
  const model = { annotations: [] };
  const first = addLayer(model, { name: 'Level 1 fixtures' }).layer;
  const east = addLayer(model, { name: 'Area East', visible: false }).layer;
  const west = addLayer(model, { name: 'Area West' }).layer;
  model.annotations.push(line(1, first.id, 100), line(2, east.id, 100), line(2, west.id, 300));
  return { bytes: await save(await source.save(), model), first, east, west };
}

function ocgNames(pdf) {
  const oc = pdf.catalog.lookup(N('OCProperties'));
  if (!(oc instanceof PDFDict)) return [];
  return pdf.context.lookup(oc.get(N('OCGs'))).asArray()
    .map((ref) => pdf.context.lookup(ref).get(N('Name')).decodeText());
}

test('an extracted page keeps its markups on their layers, hidden state and all', async () => {
  const { bytes, east, west } = await drawing();
  const source = await PDFDocument.load(bytes);
  const extract = await PDFDocument.load(await (await extractPdfLibPages(source, [2])).save());

  assert.deepEqual(ocgNames(extract), ['Area East', 'Area West'], 'only the layers the page uses');
  const context = extract.context;
  const oc = extract.catalog.lookup(N('OCProperties'));
  const ocgs = context.lookup(oc.get(N('OCGs'))).asArray();
  const annots = context.lookup(extract.getPages()[0].node.get(N('Annots'))).asArray();
  assert.equal(annots.length, 2);
  for (const annot of annots) {
    assert.ok(ocgs.includes(context.lookup(annot).get(N('OC'))), 'each markup names a listed layer');
  }
  const d = context.lookup(oc.get(N('D')));
  assert.deepEqual(context.lookup(d.get(N('OFF'))).asArray(), [ocgs[0]], 'Area East stays hidden');
  assert.deepEqual(context.lookup(d.get(N('Order'))).asArray(), ocgs);

  const read = leesAnnotatieLagen(extract);
  assert.deepEqual(read.lagen.map(({ id, name, visible }) => ({ id, name, visible })), [
    { id: east.id, name: 'Area East', visible: false },
    { id: west.id, name: 'Area West', visible: true },
  ]);

  // Another reader's view of the same file.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: await extract.save(), isEvalSupported: false, verbosity: 0 });
  try {
    const reader = await task.promise;
    const config = await reader.getOptionalContentConfig();
    const groups = [...config].map(([, group]) => [group.name, group.visible]);
    assert.deepEqual(groups, [['Area East', false], ['Area West', true]]);
  } finally {
    await task.destroy();
  }
});

test('a markup /P points at the extracted page, not at a copy of the source tree', async () => {
  const { bytes } = await drawing();
  const source = await PDFDocument.load(bytes);
  for (const page of source.getPages()) {
    for (const ref of source.context.lookup(page.node.get(N('Annots'))).asArray()) {
      source.context.lookup(ref).set(N('P'), page.ref);
    }
  }
  const extract = await extractPdfLibPages(source, [2]);
  const page = extract.getPages()[0];
  for (const ref of extract.context.lookup(page.node.get(N('Annots'))).asArray()) {
    assert.equal(extract.context.lookup(ref).get(N('P')), page.ref);
  }
  const pages = extract.context.enumerateIndirectObjects()
    .filter(([, obj]) => obj instanceof PDFDict && String(obj.get(N('Type'))) === '/Page');
  assert.equal(pages.length, 1, 'no stray pages from the source');
  assert.deepEqual(ocgNames(extract), ['Area East', 'Area West']);
});

test('pages without layered markups extract as before', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  source.addPage([595, 842]);
  const extract = await extractPdfLibPages(source, [2, 1]);
  assert.equal(extract.getPageCount(), 2);
  assert.equal(extract.catalog.get(N('OCProperties')), undefined);
  assert.equal(extract.catalog.get(N('OPS_AnnotLayers')), undefined);
});

test('unknown add-on catalog fields refuse extraction without an installed add-on', async () => {
  const source = await PDFDocument.create();
  source.addPage([200, 200]);
  source.addPage([200, 200]);
  const addonKey = N('ODX_missing_2eaddon_State');
  const ordinaryKey = N('OtherPublisherData');
  source.catalog.set(addonKey, PDFHexString.fromText('page-linked state'));
  source.catalog.set(ordinaryKey, PDFHexString.fromText('unrelated metadata'));
  const reopened = await PDFDocument.load(await source.save());

  await assert.rejects(extractPdfLibPages(reopened, [1]), /Cannot extract pages with add-on PDF data/);
  assert.equal(reopened.catalog.get(addonKey).decodeText(), 'page-linked state');
  assert.equal(reopened.getPageCount(), 2);

  reopened.catalog.delete(addonKey);
  const extract = await extractPdfLibPages(reopened, [2]);
  assert.equal(extract.getPageCount(), 1, 'unrelated catalog keys do not block extraction');
});
