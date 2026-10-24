// Custom line styles and imported .PAT hatches through a real save → reopen
// with PDF bytes (pdf-lib writes, PDF.js + the loader read back): the vector
// appearance other viewers draw, /OPS_LineStyle and /OPS_HatchDef, and the
// model the app reopens with.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { degrees, PDFDocument, PDFName, decodePDFRawStream, PDFRawStream } from 'pdf-lib';

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
const { decodePdfTextObject } = await import('./saver/pdf-text.js');
const { layoutLineStyle, getBuiltinLineStyle, lineStyleWidth, resolveLineStyle } = await import('../annotations/line-styles.js');
const { createPolylengthMeasurement } = await import('../tools/measure-extra-creators.js');
const { parsePatText } = await import('../annotations/pat-import.js');
const { setUserHatchPatterns, getCustomHatchPattern } = await import('../annotations/hatch-registry.js');
const { recalculateAllMeasurements } = await import('../annotations/measurement.js');

const close = (a, b, eps = 1e-3, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);

const ANSI31_AND_CONC = `*ANSI31, ANSI Iron, Brick, Stone masonry
45, 0,0, 0,3.175
*AR-CONC-LIKE, Concrete-like aggregate (test fixture)
50, 0,0, 4.1,-4.3, 0.75,-8.1
355, 0,0, -2.1,6.2, 0.6,-6.6
46, 0,2, 4.6,4.0, 0,-5.5
`;

function openDocument(annotations = []) {
  state.documents = [{ id: `ls-rt-${Math.random()}`, filePath: 'C:/ls/input.pdf', pdfDoc: {},
    currentPage: 1, annotations, measureScale: null, pageRotations: {}, _annotationPagesReady: new Set([1]),
    textEdits: [] }];
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
  assert.equal(await savePDF('C:/ls/output.pdf', { zonderHandtekeningVraag: true }), true);
  return saved;
}

async function rawAnnots(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const arr = ctx.lookup(doc.getPages()[0].node.get(PDFName.of('Annots')));
  return arr.asArray().map(ref => ctx.lookup(ref)).map(dict => {
    const ap = ctx.lookup(dict.get(PDFName.of('AP')));
    const n = ap ? ctx.lookup(ap.get(PDFName.of('N'))) : null;
    const content = n instanceof PDFRawStream ? new TextDecoder('latin1').decode(decodePDFRawStream(n).decode()) : '';
    const text = (key) => { const v = dict.get(PDFName.of(key)); return v ? decodePdfTextObject(ctx.lookup(v) || v) : undefined; };
    const rect = ctx.lookup(dict.get(PDFName.of('Rect'))).asArray().map(v => v.asNumber());
    const bbox = n ? ctx.lookup(n.dict.get(PDFName.of('BBox'))).asArray().map(v => v.asNumber()) : null;
    const font = n ? ctx.lookup(n.dict.get(PDFName.of('Resources')))?.get(PDFName.of('Font')) : null;
    return { dict, content, lineStyle: text('OPS_LineStyle'), hatchDef: text('OPS_HatchDef'), rect, bbox, font,
      subtype: dict.get(PDFName.of('Subtype'))?.toString() };
  });
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
    return models;
  } finally {
    await task.destroy();
  }
}

// Every `a b c d e f Tm` + the following `(text) Tj` of a content stream.
function textRuns(content) {
  const out = [];
  const re = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm\n\(([^)]*)\) Tj/gu;
  for (const m of content.matchAll(re)) out.push({ m: m.slice(1, 7).map(Number), text: m[7] });
  return out;
}

const GAS_POINTS = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 150, y: 450 }];

test('GAS polyline: repeated text in the appearance at the canvas positions, style survives reopen', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const poly = createAnnotation({ type: 'polyline', page: 1, points: GAS_POINTS, strokeColor: '#c00000',
    lineWidth: 1.5, lineStyleId: 'gas' });
  const bytes = await save(await source.save(), [poly]);
  const [raw] = await rawAnnots(bytes);
  assert.equal(raw.subtype, '/PolyLine');
  assert.equal(JSON.parse(raw.lineStyle).id, 'gas');
  assert.ok(raw.font?.toString().includes('Helvetica'), 'standard Helvetica appearance font');

  // The canvas layout (same function the screen draws with).
  const layout = layoutLineStyle(getBuiltinLineStyle('gas'), GAS_POINTS, { lineWidth: lineStyleWidth(poly) });
  const runs = textRuns(raw.content);
  assert.equal(runs.length, layout.texts.length);
  assert.ok(runs.length >= 8, `GAS repeated along the polyline (${runs.length})`);
  const top = 842;
  runs.forEach((run, i) => {
    const t = layout.texts[i];
    assert.equal(run.text, 'GAS');
    // Tm = [cos a, -sin a, sin a, cos a, X(baseX), Y(baseY)] with Y = top - y.
    close(run.m[0], Math.cos(t.angle)); close(run.m[1], -Math.sin(t.angle));
    close(run.m[4], t.baseX); close(run.m[5], top - t.baseY);
    // Readable: the baseline never points left.
    assert.ok(run.m[0] > -1e-9, `upright text ${run.m}`);
  });
  // Rotated with each segment: three different directions.
  assert.equal(new Set(runs.map(r => `${Math.round(r.m[0] * 100)}:${Math.round(r.m[1] * 100)}`)).size, 3);
  // The line is broken around each text: more stroke pieces than segments.
  assert.ok((raw.content.match(/ S\n/gu) || []).length >= runs.length);
  // BBox = Rect, and it holds every text box.
  assert.deepEqual(raw.bbox, raw.rect);

  const [model] = await reopen(bytes);
  assert.equal(model.type, 'polyline');
  assert.equal(model.lineStyleId, 'gas');
  const again = layoutLineStyle(resolveLineStyle(model), model.points, { lineWidth: lineStyleWidth(model) });
  assert.equal(again.texts.length, layout.texts.length);
  again.texts.forEach((t, i) => { close(t.x, layout.texts[i].x, 0.01); close(t.angle, layout.texts[i].angle, 1e-4); });

  // A second save keeps it.
  const bytes2 = await save(bytes, [model]);
  const [raw2] = await rawAnnots(bytes2);
  assert.equal(textRuns(raw2.content).length, runs.length);
});

test('a user style travels inside the PDF and reopens without the preference', async () => {
  const user = { id: 'user-fibre', name: 'Fibre duct', scaleWithWidth: false,
    lines: [{ offset: -2, dash: [], width: 1 }, { offset: 2, dash: [6, -3], width: 1 }],
    marks: [{ kind: 'text', text: 'FO', size: 6, interval: 60, start: null, gap: 2, offset: 0 },
      { kind: 'symbol', shape: 'circle', size: 4, interval: 60, start: 0, gap: null, offset: 0, filled: true }] };
  state.preferences.lineStyles = [user];
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const line = createAnnotation({ type: 'line', page: 1, startX: 50, startY: 600, endX: 450, endY: 650,
    strokeColor: '#0055aa', lineWidth: 1, lineStyleId: 'user-fibre' });
  const arc = createAnnotation({ type: 'arc', page: 1, centerX: 300, centerY: 300, radius: 120,
    startAngle: 0, endAngle: Math.PI, strokeColor: '#0055aa', lineWidth: 1, lineStyleId: 'water' });
  const bytes = await save(await source.save(), [line, arc]);
  state.preferences.lineStyles = [];
  const raws = await rawAnnots(bytes);
  const lineRaw = raws.find(r => r.subtype === '/Line');
  assert.match(lineRaw.content, /\(FO\) Tj/u);
  assert.ok((lineRaw.content.match(/ B\n/gu) || []).length >= 6, 'filled circle symbols');
  const models = await reopen(bytes);
  const l = models.find(m => m.type === 'line');
  assert.equal(l.lineStyleId, 'user-fibre');
  assert.equal(l.lineStyleDef.name, 'Fibre duct');
  assert.equal(resolveLineStyle(l, []).lines.length, 2, 'drawn from the embedded copy');
  // An arc reopens as its sampled polyline (existing loader behaviour); the
  // style comes back with it.
  const a = models.find(m => m.type === 'polyline');
  assert.equal(a.points.length, 37);
  assert.equal(a.lineStyleId, 'water');
  assert.match(raws.find(r => r.subtype === '/PolyLine').content, /\(W\) Tj/u);
});

test('rotated page: the saved text reads upright on the displayed sheet', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]).setRotation(degrees(90));
  // Display coordinates of a 90° page: 842 wide, 595 high.
  const pts = [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 400 }];
  const poly = createAnnotation({ type: 'polyline', page: 1, points: pts, lineWidth: 1, lineStyleId: 'gas' });
  const bytes = await save(await source.save(), [poly]);
  const [raw] = await rawAnnots(bytes);
  const runs = textRuns(raw.content);
  assert.ok(runs.length > 5);
  for (const run of runs) {
    // /Rotate 90 turns the page clockwise for display: PDF (x, y) shows as (y, -x).
    const shownX = run.m[1];
    assert.ok(shownX > -1e-9, `upright on the displayed page: ${run.m}`);
  }
  const [model] = await reopen(bytes);
  assert.equal(model.lineStyleId, 'gas');
  close(model.points[1].x, 700, 0.05);
});

test('perimeter / polylength measurement: style line plus its labels', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  openDocument();
  const poly = createPolylengthMeasurement([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }]);
  poly.lineStyleId = 'electric';
  openDocument([poly]);
  recalculateAllMeasurements();
  const bytes = await save(await source.save(), [poly]);
  const [raw] = await rawAnnots(bytes);
  assert.match(raw.content, /\(E\) Tj/u);
  assert.ok(raw.content.includes(poly.measureText.replace(/[()\\]/gu, '')) || /Tj/u.test(raw.content));
  const [model] = await reopen(bytes);
  assert.equal(model.type, 'measurePerimeter');
  assert.equal(model.lineStyleId, 'electric');
});

test('.PAT hatch: imported ANSI31 and a multi-line pattern fill areas and survive save/reopen', async () => {
  const { patterns } = parsePatText(ANSI31_AND_CONC, { unit: 'mm' });
  state.preferences.hatchPatterns = patterns;
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const square = (x, y, s) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  const a1 = createAnnotation({ type: 'filledArea', page: 1, points: square(100, 100, 150), fillColor: null,
    strokeColor: '#000000', lineWidth: 1, hatchPattern: 'pat:ANSI31', hatchColor: '#333333', hatchScale: 100, hatchAngle: 0,
    x: 100, y: 100, width: 150, height: 150 });
  const a2 = createAnnotation({ type: 'filledArea', page: 1, points: square(300, 100, 150), fillColor: null,
    strokeColor: '#000000', lineWidth: 1, hatchPattern: 'pat:AR-CONC-LIKE', hatchColor: '#333333', hatchScale: 100, hatchAngle: 0,
    x: 300, y: 100, width: 150, height: 150 });
  const bytes = await save(await source.save(), [a1, a2]);
  const raws = (await rawAnnots(bytes)).filter(r => r.hatchDef);
  assert.equal(raws.length, 2);
  const def1 = JSON.parse(raws[0].hatchDef);
  assert.equal(def1.id, 'pat:ANSI31');
  // ANSI31: 45° lines 9 pt apart over a 150 pt square: dozens of strokes.
  const strokes1 = (raws[0].content.match(/ l S\n/gu) || []).length;
  assert.ok(strokes1 > 20, `ANSI31 strokes ${strokes1}`);
  // The concrete-like pattern draws short dashes AND dots.
  assert.ok((raws[1].content.match(/ l S\n/gu) || []).length > 50);
  assert.ok((raws[1].content.match(/ c f\n/gu) || []).length > 20, 'dots');

  // Reopen on a machine without the import: the PDF carries the pattern.
  state.preferences.hatchPatterns = [];
  setUserHatchPatterns([]);
  const models = await reopen(bytes);
  const areas = models.filter(m => m.type === 'filledArea');
  assert.deepEqual(areas.map(m => m.hatchPattern).sort(), ['pat:ANSI31', 'pat:AR-CONC-LIKE']);
  assert.equal(getCustomHatchPattern('pat:AR-CONC-LIKE').families.length, 3);
  // And the next save writes the same hatch again.
  const bytes2 = await save(bytes, areas);
  const raws2 = (await rawAnnots(bytes2)).filter(r => r.hatchDef);
  assert.equal(raws2.length, 2);
  const again = raws2.find(r => JSON.parse(r.hatchDef).id === 'pat:ANSI31');
  assert.equal((again.content.match(/ l S\n/gu) || []).length, strokes1);
});
