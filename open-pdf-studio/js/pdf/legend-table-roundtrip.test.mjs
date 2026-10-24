// A table placed on the page (measurement legend, placed schedule) keeps its
// title, columns and rows through save and reopen: real bytes through the
// real saver, read back with pdf.js and the annotation converter.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
// pdf-lib through the same loader as the app modules, so PDFName matches.
const { PDFDocument } = await import('pdf-lib');
const { state } = await import('../core/state.js');
const { savePDF } = await import('./saver.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { formatMeasurement } = await import('../annotations/measurement.js');
const { measurementLegend, legendTable } = await import('../quantities/measurement-legend.js');
const { convertPdfAnnotation } = await import('./loader/annotation-converter.js');
const { extractAnnotationColors } = await import('./loader/color-extraction.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

test('a placed measurement legend reopens with its rows', async () => {
  const src = await PDFDocument.create();
  src.addPage([1224, 792]);
  const bytes = await src.save();
  const measures = [
    { type: 'measureDistance', page: 1, measureValue: 10, measureUnit: 'ft', strokeColor: '#ff0000' },
    { type: 'measureArea', page: 1, measureValue: 12.5, measureUnit: 'ft²', color: '#0000ff', subject: 'Slab' },
  ];
  const table = legendTable(measurementLegend(measures, { page: 1 }), { title: 'Legend', color: 'Color',
    subject: 'Subject', count: 'Count', total: 'Total', typeName: () => 'Distance' }, formatMeasurement);
  const legend = createAnnotation({ type: 'scheduleTable', page: 1, x: 36, y: 36, width: table.width,
    height: table.height, title: table.title, columns: table.columns, rows: table.rows,
    color: '#000000', lineWidth: 0.5, opacity: 1 });
  state.documents = [{ id: `legend-${Math.random()}`, filePath: 'C:/lg/in.pdf', pdfDoc: { numPages: 1 },
    currentPage: 1, scale: 1, viewMode: 'single', annotations: [legend],
    measureScale: null, pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [],
    undoStack: [], redoStack: [], savedUndoStackLength: 0 }];
  state.activeDocumentIndex = 0;

  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_p, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_p, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/lg/out.pdf', { zonderHandtekeningVraag: true }), true);

  const task = pdfjs.getDocument({ data: saved.slice(), isEvalSupported: false, verbosity: 0 });
  const reopened = [];
  try {
    const page = await (await task.promise).getPage(1);
    const colors = await extractAnnotationColors(1, await PDFDocument.load(saved));
    for (const raw of await page.getAnnotations()) {
      const ann = await convertPdfAnnotation(raw, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (ann) reopened.push(ann);
    }
  } finally {
    await task.destroy();
  }
  const back = reopened.find(a => a.type === 'scheduleTable');
  assert.ok(back, 'the table comes back as a table');
  assert.equal(back.title, 'Legend');
  assert.deepEqual(back.columns, ['Color', 'Subject', 'Count', 'Total']);
  assert.deepEqual(back.rows.map(r => r.cells.slice(1)), [['Distance', '1', '10\'-0"'], ['Slab', '1', '12.50 ft²']]);
  assert.ok(back.rows[0].cells[0].startsWith('data:image/svg+xml,'), 'the colour swatch survives');
  assert.ok(Math.abs(back.x - 36) < 0.5 && Math.abs(back.y - 36) < 0.5);
});
