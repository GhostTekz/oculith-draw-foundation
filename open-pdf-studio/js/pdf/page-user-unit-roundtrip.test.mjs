import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';

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
const { schaalUitMeasure } = await import('./pdf-viewports.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function save(bytes, annotations) {
  let written;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFileAtomic: (_path, output) => { written = output.slice(); },
  } };
  state.documents = [{ id: 'user-unit-test', filePath: '/tmp/user-unit-source.pdf', pdfDoc: {},
    currentPage: 1, scale: 1, viewMode: 'single', annotations,
    selectedAnnotation: null, selectedAnnotations: [], undoStack: [], redoStack: [],
    modified: true, savedUndoStackLength: -1, pageRotations: {},
    _annotationPagesReady: new Set([1]), textEdits: [], watermarks: [], bookmarks: [] }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('/tmp/user-unit-output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(written);
  return written;
}

async function reopen(bytes) {
  const lib = await PDFDocument.load(bytes.slice());
  const colors = await extractAnnotationColors(1, lib);
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  try {
    const page = await reader.getPage(1);
    const models = [];
    for (const ann of await page.getAnnotations()) {
      const model = await convertPdfAnnotation(ann, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (model) models.push(model);
    }
    return models;
  } finally { await task.destroy(); }
}

const lineCoordinates = ann => [ann.startX, ann.startY, ann.endX, ann.endY];
const near = (actual, wanted) => actual.every((value, i) => Math.abs(value - wanted[i]) < 0.02);

test('line geometry stays in page-view space through two saves with UserUnit, crop and rotation', async () => {
  const wanted = [40, 60, 80, 60];
  for (const userUnit of [0.5, 1, 2]) {
    for (const rotation of [0, 90, 180, 270]) {
      const source = await PDFDocument.create();
      const page = source.addPage([600, 800]);
      page.setCropBox(50, 70, 300, 400);
      page.setRotation(degrees(rotation));
      page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
      const ann = createAnnotation({ type: 'line', page: 1,
        startX: wanted[0], startY: wanted[1], endX: wanted[2], endY: wanted[3],
        color: '#000000', strokeColor: '#000000', lineWidth: 2, opacity: 1 });
      const firstBytes = await save(await source.save(), [ann]);
      const first = await reopen(firstBytes);
      const line1 = first.find(item => item.type === 'line');
      assert.ok(line1 && near(lineCoordinates(line1), wanted), `first save: unit ${userUnit}, rotation ${rotation}: ${JSON.stringify(line1)}`);
      const second = await reopen(await save(firstBytes, first));
      const line2 = second.find(item => item.type === 'line');
      assert.ok(line2 && near(lineCoordinates(line2), wanted), `second save: unit ${userUnit}, rotation ${rotation}: ${JSON.stringify(line2)}`);
    }
  }
});

test('unknown nonempty PDF measurement units are never assumed to be millimetres', () => {
  assert.equal(schaalUitMeasure(1, 'furlong'), null);
  assert.deepEqual(schaalUitMeasure(1, 'meters')?.unit, 'm');
  assert.equal(schaalUitMeasure(1, ' ')?.unit, 'mm');
});
