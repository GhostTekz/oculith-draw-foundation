import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./addon-box-tools-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { composeAddons } = await import('../editions/compose-addons.js');
const { edition: foundation } = await import('../editions/community.js');
const id = 'sample.tools';
const boxId = `addon:${id}:review-box`;
const v1Id = 'legacy-shape';
const fullEdition = { ...foundation, tools: { shapeToolIds: [v1Id], allowClick: [v1Id],
  createAnnotation: (_id, context) => ({ type: 'box', page: context.page,
    ...context.box, subject: 'Legacy' }) } };
const { edition, accepted } = composeAddons(fullEdition, [{ id, addon: { apiVersion: 2, id,
  boxTools: [{ id: boxId, style: { strokeColor: '#123456', fillColor: null,
    lineWidth: 2, subject: 'Review' } }],
} }]);
assert.deepEqual(accepted, [id]);
globalThis.__ocudrawEdition = edition;
const { state } = await import('../core/state.js');
const { registerAddonBoxTools } = await import('./addon-box-tools.js');
const { shapeTool } = await import('./tools/shape-tool.js');
const { getTool, registerTool } = await import('./tool-registry.js');
const { buildAnnotationProps, createAnnotationFromTool } = await import('./annotation-creators.js');

function openDoc() {
  const doc = { id: 'box-tools-browser', currentPage: 1, viewMode: 'single', filePath: null,
    pdfDoc: { numPages: 1 }, annotations: [], selectedAnnotations: [], selectedAnnotation: null,
    undoStack: [], redoStack: [], pageRotations: {}, textEdits: [] };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  state.toolOverrides = {};
  return doc;
}

test('a package box tool uses the core drag path beside a v1 edition tool', () => {
  const doc = openDoc();
  registerTool('box', shapeTool);
  registerTool(v1Id, shapeTool);
  registerAddonBoxTools(edition.boxTools);
  assert.equal(getTool(boxId)?.name, 'shape');
  assert.equal(getTool(v1Id)?.name, 'shape');
  assert.equal(getTool('box')?.name, 'shape');
  const legacy = buildAnnotationProps(v1Id, 10, 20, 50, 70, null);
  assert.equal(legacy.subject, 'Legacy');
  const preview = buildAnnotationProps(boxId, 10, 20, 50, 70, null);
  assert.deepEqual([preview.type, preview.x, preview.y, preview.width, preview.height],
    ['box', 10, 20, 40, 50]);
  assert.equal(preview.strokeColor, '#123456');
  assert.equal(preview.subject, 'Review');

  state.currentTool = boxId;
  state.startX = 10;
  state.startY = 20;
  const recorded = [];
  const ctx = { state, x: 50, y: 70, scale: 1,
    snap: () => ({ snapped: false }), snapToGrid: (value) => value,
    createAnnotationFromTool, recordAdd: (ann) => recorded.push(ann), redraw: () => {} };
  const tool = getTool(boxId);
  tool.onPointerDown(ctx, { button: 0 });
  assert.equal(tool.onPointerUp(ctx, { button: 0 }), true);
  assert.equal(doc.annotations.length, 1);
  assert.equal(recorded[0], doc.annotations[0]);
  assert.deepEqual([recorded[0].type, recorded[0].subject, recorded[0].strokeColor],
    ['box', 'Review', '#123456']);
  assert.equal(createAnnotationFromTool(v1Id, 10, 20, 50, 70, null).subject, 'Legacy');
});

test('a package box survives a real PDF save and reopen through the core codec', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const { savePDF } = await import('../pdf/saver.js');
  const { convertPdfAnnotation } = await import('../pdf/loader/annotation-converter.js');
  const { extractAnnotationColors } = await import('../pdf/loader/color-extraction.js');
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const bytes = await source.save();
  const doc = openDoc();
  doc.filePath = 'C:/addon-box/source.pdf';
  doc._annotationPagesReady = new Set([1]);
  doc.annotations = [createAnnotationFromTool(boxId, 10, 20, 50, 70, null)];
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/addon-box/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved?.length);
  const pdfLibDoc = await PDFDocument.load(saved.slice());
  const colors = await extractAnnotationColors(1, pdfLibDoc);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: saved.slice(), isEvalSupported: false, verbosity: 0 });
  const reader = await task.promise;
  try {
    const page = await reader.getPage(1);
    const raw = (await page.getAnnotations()).find((ann) => ann.subtype === 'Square');
    assert.ok(raw, 'core box is present in the saved PDF');
    const model = await convertPdfAnnotation(raw, 1, page.getViewport({ scale: 1 }), new Map(), colors);
    assert.deepEqual([model.type, model.subject, model.strokeColor], ['box', 'Review', '#123456']);
  } finally {
    await task.destroy();
  }
});
