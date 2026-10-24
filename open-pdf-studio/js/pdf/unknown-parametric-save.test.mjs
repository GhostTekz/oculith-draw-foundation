import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { PDFDocument, PDFName, PDFString, PDFHexString } = await import('pdf-lib');

test('saving an older PDF with an unavailable parametric symbol refuses a destructive rewrite', async () => {
  const source = await PDFDocument.create();
  source.addPage([420, 300]);
  source.addPage([420, 300]);
  const context = source.context;
  const olderSymbol = context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [25, 30, 145, 60],
    Contents: PDFString.of('Old floor section'),
    OPS_Subtype: PDFString.of('parametricSymbol'),
    OPS_SymbolId: PDFHexString.fromText('vloer-kanaalplaatvloer'),
    OPS_Params: PDFHexString.fromText(JSON.stringify({ maat: '200 standaard' })),
  });
  const appearance = context.stream('q 0 0 0 RG 2 w 0 0 m 120 30 l S Q',
    { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 120, 30] });
  olderSymbol.set(PDFName.of('AP'), context.obj({ N: context.register(appearance) }));
  source.getPage(0).node.addAnnot(context.register(olderSymbol));
  const originalBytes = new Uint8Array(await source.save());
  let writes = 0;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => originalBytes,
    writeBinaryFile: () => { writes++; return true; },
    writeBinaryFileAtomic: () => { writes++; return true; },
  } };
  const doc = {
    id: 'older-floor-plan', filePath: '/local/older-floor-plan.pdf', pdfDoc: { numPages: 2 },
    currentPage: 2, annotations: [{ id: 'old-floor', type: 'parametricSymbol', page: 1,
      symbolId: 'vloer-kanaalplaatvloer', params: { maat: '200 standaard' },
      x: 24, y: 40, width: 120, height: 30 },
      { id: 'new-note', type: 'line', page: 2, startX: 40, startY: 50, endX: 120, endY: 90 }],
    modified: true,
  };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  const activeDoc = state.documents[0];
  const original = JSON.stringify(activeDoc.annotations);
  const logged = [];
  const previousError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    assert.equal(await savePDF(null, { zonderHandtekeningVraag: true }, activeDoc), false);
  } finally {
    console.error = previousError;
  }
  assert.match(logged[0]?.[1]?.message || '', /symbol template "vloer-kanaalplaatvloer" is unavailable/);
  assert.equal(writes, 0, 'no PDF bytes were written');
  assert.deepEqual(globalThis.__saverTest.impl.getCachedPdfBytes(), originalBytes,
    'the original two-page PDF and embedded appearance stay intact');
  assert.equal(JSON.stringify(activeDoc.annotations), original, 'the object identity and metadata remain in memory');
  assert.equal(activeDoc.modified, true, 'the edit remains unsaved');
});
