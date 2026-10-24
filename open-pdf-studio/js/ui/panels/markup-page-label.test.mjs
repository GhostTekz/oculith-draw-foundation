// Markups List Page Label column: the PDF's own page labels (/PageLabels,
// read by PDF.js), else the page number; sorted, filtered and exported.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { list, store, showList } = await import('./annotations-list.testhulp.mjs');
const { markupCsv } = await import('../../annotations/markup-csv.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function labelledPdf() {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage([200, 200]);
  const ctx = pdf.context;
  // Page 1: "Cover"; pages 2-3: "A-101", "A-102".
  pdf.catalog.set(PDFName.of('PageLabels'), ctx.obj({ Nums: [
    0, ctx.obj({ P: PDFString.of('Cover') }),
    1, ctx.obj({ S: PDFName.of('D'), P: PDFString.of('A-'), St: 101 }),
  ] }));
  return pdfjs.getDocument({ data: await pdf.save(), isEvalSupported: false, verbosity: 0 });
}
const box = (id, page) => ({ id, type: 'box', page, x: 0, y: 0, width: 5, height: 5, author: 'A',
  createdAt: '2026-10-01T00:00:00Z' });
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('rows show the PDF page labels once PDF.js has read them; sort, filter and CSV use them', async () => {
  showList();
  const task = await labelledPdf();
  const reader = await task.promise;
  try {
    const doc = { id: 'labels', currentPage: 1, viewMode: 'single', selectedAnnotations: [], pdfDoc: reader,
      annotations: [box('c', 3), box('a', 1), box('b', 2)] };
    state.documents = [doc];
    state.activeDocumentIndex = 0;
    store.setColumnFilters({});
    store.setColumnSort(null);
    list.updateAnnotationsList();
    await settle();
    const labels = () => Object.fromEntries(store.items().filter(i => !i.isHeader).map(i => [i.id, i.pageLabel]));
    assert.deepEqual(labels(), { a: 'Cover', b: 'A-101', c: 'A-102' });
    store.setColumnSort({ column: 'pageLabel', direction: 'descending' });
    store.setSortMode('type');
    list.updateAnnotationsList();
    assert.deepEqual(store.items().filter(i => !i.isHeader).map(i => i.pageLabel), ['Cover', 'A-102', 'A-101']);
    store.setSortMode('page');
    store.setColumnSort(null);
    assert.deepEqual(list.markupColumnFilterValues('pageLabel').map(v => v.value), ['A-101', 'A-102', 'Cover']);
    store.setColumnFilters({ pageLabel: ['Cover'] });
    list.updateAnnotationsList();
    assert.deepEqual(store.items().filter(i => !i.isHeader).map(i => i.id), ['b', 'c']);
    store.setColumnFilters({});
    const csv = markupCsv(doc.annotations, null, '', null, null, null, null, '', null, null,
      { pageLabel: annotation => list.markupPageLabel(doc, annotation.page) });
    assert.match(csv.split('\r\n')[0], /"Page label"$/u);
    assert.match(csv, /"A-102"\r\n/u);
  } finally {
    await task.destroy();
  }
});

test('without page labels the label is the page number', () => {
  showList();
  const doc = { id: 'plain', currentPage: 1, viewMode: 'single', selectedAnnotations: [],
    pdfDoc: { getPageLabels: async () => null }, annotations: [box('a', 4)] };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  list.updateAnnotationsList();
  assert.equal(store.items().find(i => !i.isHeader).pageLabel, '4');
  assert.equal(list.markupPageLabel({}, 7), '7');
});
