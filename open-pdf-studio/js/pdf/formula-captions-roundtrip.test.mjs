// Formula columns with expressions and Custom Captions: pure evaluation and a
// real save/reopen through saver.js, the pdf.js converter and the catalog.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { degrees, PDFDocument, PDFName } from 'pdf-lib';

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
const { recalculateAllMeasurements } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { ensureMarkupColumnsReady } = await import('./markup-columns.js');
const {
  parseFormulaExpression, evaluateExpressionColumns, expressionColumnTotals, expressionColumns,
  expressionColumnError, captionText, captionTemplateFor, measurementQuantities, EXPRESSION_COLUMNS_MAX,
} = await import('../annotations/formula-captions.js');
const { readFormulaCaptions, FORMULA_CAPTIONS_KEY, CAPTION_TEMPLATE_KEY } = await import('./formula-captions-pdf.js');

// 1 pt = 1 ft on the sheet.
const FT = { pixelsPerUnit: 1, unit: 'ft' };
const costColumn = { version: 1, name: 'Cost/sf' };
const columns = [
  { name: 'Cost', expression: 'Area × {Cost/sf}', unit: '$', decimals: 2, lengthUnit: '' },
  { name: 'With waste', expression: '{Cost} * (1 + 10 / 100)', unit: '$', decimals: 2, lengthUnit: '' },
  { name: 'Area m2', expression: '[Area]', unit: 'm²', decimals: 3, lengthUnit: 'm' },
];
const captions = { measureArea: '{Subject} {Area} {Cost}' };

function square(x, y, w, h, extra = {}) {
  return createAnnotation({ type: 'measureArea', page: 1,
    points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], ...extra });
}

function openDocument(measureScale, annotations = [], extra = {}) {
  state.documents = [{ id: `formula-rt-${Math.random()}`, filePath: 'C:/takeoff/input.pdf', pdfDoc: {},
    currentPage: 1, annotations, measureScale, pageRotations: {}, _annotationPagesReady: new Set([1]),
    textEdits: [], markupNumberColumn: costColumn,
    formulaCaptions: { v: 1, columns, captions }, ...extra }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function save(bytes, doc) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/takeoff/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

async function reopen(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const pdfLibDoc = await PDFDocument.load(bytes.slice());
    const colors = await extractAnnotationColors(1, pdfLibDoc);
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

test('the expression parser handles precedence, × ÷ −, references and rejects unsafe input', () => {
  const doc = { markupNumberColumn: costColumn };
  const evalWith = (expression, ann = { markupNumberValue: 4 }) =>
    evaluateExpressionColumns(ann, doc, [{ name: 'R', expression, decimals: 6 }])[0];
  assert.equal(evalWith('2 + 3 * 4').value, 14);
  assert.equal(evalWith('(2 + 3) * 4').value, 20);
  assert.equal(evalWith('10 ÷ 4 − 1').value, 1.5);
  assert.equal(evalWith('-{Cost/sf} * -2').value, 8);
  assert.equal(evalWith('.5 * [cost/sf]').value, 2, 'references fold case');
  assert.equal(evalWith('1 / 0').value, null);
  assert.equal(evalWith('1 / 0').warning, 'error');
  assert.equal(evalWith('{Cost/sf} * 2', {}).warning, 'missing');
  for (const bad of ['', '2 +', '(1', 'alert(1)', '1; 2', 'a.b', '2 ** 3', '{Cost', '"x"', '1e3']) {
    const parsed = parseFormulaExpression(bad);
    if (!parsed.error) {
      assert.ok(expressionColumnError({ name: 'X', expression: bad }, doc), `rejected: ${bad}`);
    }
  }
  assert.match(expressionColumnError({ name: 'X', expression: 'Area * Price' }, doc), /Unknown/u);
  assert.match(expressionColumnError({ name: 'Cost/sf', expression: '1' }, doc), /already named/u);
  assert.match(expressionColumnError({ name: 'Area', expression: '1' }, doc), /measurement/u);
  assert.equal(expressionColumnError({ name: 'Total', expression: 'Wall Area * 2' }, doc),
    'Unexpected "Area"', 'two-word names need braces');
  assert.equal(expressionColumnError({ name: 'Total', expression: '{Wall Area} * WallArea' }, doc), '');
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `F${i}`, expression: '1' }));
  assert.equal(expressionColumns(six).length, EXPRESSION_COLUMNS_MAX);
});

test('measurement values: wall area, depth, volume, count and unit conversion', () => {
  const wall = { type: 'measurePerimeter', measureValue: 7000, measureUnit: 'mm',
    measureDepth: 2.4, measureDepthUnit: 'm', measureWallAreaValue: 7000 * 2400 };
  const q = measurementQuantities(wall);
  assert.equal(q.calibrated, true);
  assert.equal(q.depth, 2400);
  const [m2, depth] = evaluateExpressionColumns(wall, {}, [
    { name: 'Wall m2', expression: '{Wall Area}', decimals: 2, lengthUnit: 'm' },
    { name: 'Height', expression: 'Depth', decimals: 3, lengthUnit: 'm' },
  ]);
  assert.equal(m2.value, 16.8);
  assert.equal(depth.value, 2.4);
  const count = evaluateExpressionColumns({ type: 'count' }, {}, [{ name: 'Each', expression: 'Count * 12.5' }])[0];
  assert.equal(count.value, 12.5);
  const vol = { type: 'measureArea', measureValue: 2e6, measureUnit: 'mm²', measureVolumeValue: 6e8 };
  assert.equal(evaluateExpressionColumns(vol, {}, [{ name: 'V', expression: 'Volume', decimals: 3, lengthUnit: 'm' }])[0].value, 0.6);
  const ptLength = { type: 'measureDistance', measureValue: 70, measureUnit: 'pt' };
  const blank = evaluateExpressionColumns(ptLength, {}, [{ name: 'L', expression: 'Length * 2' }])[0];
  assert.equal(blank.value, null);
  assert.equal(blank.warning, 'uncalibrated');
});

test('area takeoff with Cost/sf: totals, blank uncalibrated results, save/reopen and captions', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  page.setRotation(degrees(90));
  const a = square(100, 100, 10, 20, { subject: 'Slab A', markupNumberValue: 12.5 }); // 200 sf
  const b = square(200, 100, 15, 10, { subject: 'Slab B', markupNumberValue: 8 }); // 150 sf
  const c = square(300, 300, 30, 30, { subject: 'Slab C' }); // 900 sf, no price
  b.captionTemplate = '{Cost/sf} $/sf → {With waste}';
  const doc = openDocument(FT, [a, b, c]);
  recalculateAllMeasurements();
  // A measurement's subject survives the PDF in /Subj (its /Contents holds the
  // measured text), so after reopening the caption still starts with it.
  const check = (list, d, subject = 'Slab A ') => {
    const [ra, rb, rc] = list;
    assert.deepEqual(evaluateExpressionColumns(ra, d).map(r => r.text), ['2500.00 $', '2750.00 $', '18.581 m²']);
    assert.deepEqual(evaluateExpressionColumns(rb, d).map(r => r.text), ['1200.00 $', '1320.00 $', '13.935 m²']);
    assert.deepEqual(evaluateExpressionColumns(rc, d).map(r => r.warning), ['missing', 'missing', null]);
    const totals = expressionColumnTotals(list, d);
    assert.deepEqual(totals.map(t => t.total), [3700, 4070, 116.129]);
    assert.deepEqual(totals.map(t => t.counted), [2, 2, 3]);
    assert.equal(totals[0].text, '3700.00 $');
    assert.equal(captionText(captionTemplateFor(ra, d), ra, d), `${subject}200 ft² 2500.00 $`);
    assert.equal(captionText(captionTemplateFor(rb, d), rb, d), '8 $/sf → 1320.00 $');
  };
  check([a, b, c], doc);

  // The caption follows its column values.
  a.markupNumberValue = 10;
  assert.equal(captionText(captionTemplateFor(a, doc), a, doc), 'Slab A 200 ft² 2000.00 $');
  a.markupNumberValue = 12.5;

  const bytes = await save(await source.save(), doc);
  const raw = await PDFDocument.load(bytes);
  assert.ok(raw.catalog.get(PDFName.of(FORMULA_CAPTIONS_KEY)), 'catalog carries the model');
  const annots = raw.getPage(0).node.lookup(PDFName.of('Annots')).asArray().map(ref => raw.context.lookup(ref));
  assert.equal(annots.filter(dict => dict.get(PDFName.of(CAPTION_TEMPLATE_KEY))).length, 1);

  // Reopen: catalog read by the early-hydration path, values and template from the file.
  const { models, pdfLibDoc } = await reopen(bytes);
  assert.deepEqual(readFormulaCaptions(pdfLibDoc), { v: 1, columns: expressionColumns(columns), captions });
  const reopened = { markupNumberColumn: null, formulaCaptions: null,
    _sharedPdfLibDocPromise: Promise.resolve(pdfLibDoc) };
  await ensureMarkupColumnsReady(reopened);
  assert.deepEqual(reopened.markupNumberColumn, costColumn);
  assert.deepEqual(reopened.formulaCaptions.columns, expressionColumns(columns));
  const areas = models.filter(m => m.type === 'measureArea').sort((x, y) => x.points[0].x - y.points[0].x);
  assert.equal(areas.length, 3);
  assert.equal(areas[1].captionTemplate, b.captionTemplate);
  const doc2 = openDocument(FT, areas, { markupNumberColumn: reopened.markupNumberColumn,
    formulaCaptions: reopened.formulaCaptions });
  recalculateAllMeasurements();
  check(areas, doc2);

  // A second save keeps one template key and the model.
  const second = await reopen(await save(bytes, doc2));
  assert.equal(second.models.filter(m => m.captionTemplate).length, 1);
  assert.ok(readFormulaCaptions(second.pdfLibDoc));
});

test('uncalibrated area markups give blank formula results with a warning and no total', async () => {
  const a = square(100, 100, 10, 20, { subject: 'Slab A', markupNumberValue: 12.5 });
  const doc = openDocument(null, [a]);
  recalculateAllMeasurements();
  assert.equal(a.measureUnit, 'pt²');
  const [cost, waste, metric] = evaluateExpressionColumns(a, doc);
  assert.equal(cost.value, null);
  assert.equal(cost.text, '');
  assert.equal(cost.warning, 'uncalibrated');
  assert.equal(waste.warning, 'uncalibrated');
  assert.equal(metric.warning, 'uncalibrated');
  const [total] = expressionColumnTotals([a], doc);
  assert.equal(total.counted, 0);
  assert.equal(total.uncalibrated, 1);
  assert.equal(total.text, '');
  assert.equal(captionText(captionTemplateFor(a, doc), a, doc), 'Slab A 200 pt² (scale not set)');
});

test('XLSX export of the takeoff: one row per markup, blank uncalibrated cells and a totals row', async () => {
  const { takeoffRows, takeoffXlsx } = await import('../annotations/formula-xlsx.js');
  const a = square(100, 100, 10, 20, { subject: 'Slab A', markupNumberValue: 12.5 });
  const b = square(200, 100, 15, 10, { subject: 'Slab B', markupNumberValue: 8 });
  const doc = openDocument(FT, [a, b]);
  recalculateAllMeasurements();
  const rows = takeoffRows([a, b], doc);
  assert.deepEqual(rows[0], ['Page', 'Type', 'Subject', 'Comment', 'Measurement', 'Unit', 'Scale', 'Cost/sf',
    'Cost ($)', 'With waste ($)', 'Area m2 (m²)']);
  assert.deepEqual(rows[1], ['1', 'measureArea', 'Slab A', '', '200.0000', 'ft²', 'set', '12.5', '2500.00', '2750.00', '18.581']);
  assert.deepEqual(rows.at(-1).slice(-3), ['3700.00', '4070.00', '32.516']);
  const bytes = takeoffXlsx([a, b], doc);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  const sheet = Buffer.from(bytes).toString('latin1');
  assert.match(sheet, /<v>3700<\/v>/u);

  const u = square(100, 100, 10, 20, { subject: 'Slab A', markupNumberValue: 12.5 });
  const docU = openDocument(null, [u]);
  recalculateAllMeasurements();
  const [, rowU, totalU] = takeoffRows([u], docU);
  assert.deepEqual(rowU.slice(4), ['200.0000', 'pt²', 'Scale not set', '12.5', '', '', '']);
  assert.deepEqual(totalU.slice(-3), ['', '', '']);
});
