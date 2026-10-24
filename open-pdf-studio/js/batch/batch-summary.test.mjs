// Batch ▸ Summary on real PDF bytes: three files written by the real saver
// (40 markups), one corrupt file, through the generic runner. One CSV, XLSX
// and PDF whose row count is the sum of the per-file summaries; the corrupt
// file is reported and the run goes on; a cancelled run returns no output.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { state } = await import('../core/state.js');
const { createAnnotation } = await import('../annotations/factory.js');
const { savePDF } = await import('../pdf/saver.js');
const { recalculateAllMeasurements } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { unzip } = await import('../bcf/bcf-zip.js');
const { runBatch, writeBatchOutputs } = await import('./runner.js');
const { readPdfMarkups, fileSummaryRows } = await import('./summary-read.js');
const { batchSummaryJob } = await import('./summary-job.js');

const fontBytes = new Uint8Array(await readFile(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf', import.meta.url)));
const MM_100 = { pixelsPerUnit: 0.01, unit: 'mm' }; // 1 pt = 100 mm
const WHEN = '2026-10-14T08:00:00.000Z';

function openDocument(measureScale, annotations, pages, extra = {}) {
  state.documents = [{ id: `batch-${Math.random()}`, filePath: 'C:/batch/input.pdf', pdfDoc: { numPages: pages },
    currentPage: 1, annotations, measureScale, pageRotations: {},
    _annotationPagesReady: new Set(Array.from({ length: pages }, (_, i) => i + 1)), textEdits: [], ...extra }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
  return state.documents[0];
}

async function source(pages, labelPrefix = null) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([842, 595]);
  if (labelPrefix) {
    const labels = doc.context.obj({ Nums: [0, doc.context.obj({ S: PDFName.of('D'), P: PDFHexString.fromText(labelPrefix), St: 101 })] });
    doc.catalog.set(PDFName.of('PageLabels'), labels);
  }
  return doc.save();
}

async function save(bytes, annotations, measureScale, pages, extra) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  openDocument(measureScale, annotations, pages, extra);
  recalculateAllMeasurements();
  assert.equal(await savePDF('C:/batch/output.pdf', { zonderHandtekeningVraag: true }), true);
  return new Uint8Array(saved);
}

const box = (page, i, extra = {}) => createAnnotation({ type: 'box', page, x: 40 + i * 30, y: 60 + i * 10, width: 24, height: 18,
  color: '#e11d48', strokeColor: '#e11d48', author: `Author ${i % 3}`, subject: i % 2 ? 'Clash' : 'Door', ...extra });
const distance = (page, i, subject = 'Length') => createAnnotation({ type: 'measureDistance', page, startX: 100,
  startY: 300 + i * 20, endX: 130 + i * 10, endY: 300 + i * 20, subject });

// A: 2 pages with labels A-101/A-102, a Trade column, 12 boxes + 3 calibrated lengths.
async function fileA() {
  const annotations = [];
  for (let i = 0; i < 12; i++) {
    const markup = box(1 + (i % 2), i, { markupTextValue: i < 6 ? 'Electrical' : 'Plumbing' });
    if (i === 0) { markup.status = 'accepted'; markup.statusBy = 'Lead'; markup.statusAt = WHEN; }
    if (i === 1) markup.replies = [{ id: 'r1', author: 'Site', text: 'Moved', createdAt: WHEN }];
    annotations.push(markup);
  }
  for (let i = 0; i < 3; i++) annotations.push(distance(1, i));
  return save(await source(2, 'A-'), annotations, MM_100, 2, { markupTextColumnName: 'Trade' });
}
// B: 15 markups, 2 of them uncalibrated lengths without a subject (a
// measurement's subject survives the save in /Subj, fix/ocudraw-save-growth).
async function fileB() {
  const annotations = [];
  for (let i = 0; i < 13; i++) annotations.push(box(1, i));
  for (let i = 0; i < 2; i++) annotations.push(distance(1, i, ''));
  return save(await source(1), annotations, null, 1);
}
// C: 10 boxes over 3 pages.
async function fileC() {
  const annotations = Array.from({ length: 10 }, (_, i) => box(1 + (i % 3), i, { subject: '=HYPERLINK("x")' }));
  return save(await source(3), annotations, null, 3);
}

const files = new Map();
files.set('C:/set/A.pdf', await fileA());
files.set('C:/set/B.pdf', await fileB());
files.set('C:/set/broken.pdf', new TextEncoder().encode('%PDF-1.7\nthis is not a pdf at all'));
files.set('C:/set/C.pdf', await fileC());
const list = [...files.keys()].map((path) => ({ path, name: path.split('/').pop() }));
const readFileFromMap = async (path) => files.get(path);

function csvLines(bytes) {
  return new TextDecoder().decode(bytes).replace(/^\uFEFF/u, '').trim().split('\r\n');
}

test('a 3-file set with 40 markups gives one CSV, XLSX and PDF; the corrupt file is reported, not fatal', async () => {
  // Keep a calibrated document active in the app: the summary must not borrow its scale.
  openDocument(MM_100, [], 1);
  const before = new Map([...files].map(([path, bytes]) => [path, bytes.slice()]));
  const perFile = [];
  for (const [path, bytes] of files) {
    if (path.includes('broken')) continue;
    perFile.push(fileSummaryRows(await readPdfMarkups(bytes, { pdfjs }), { file: path }).length);
  }
  assert.deepEqual(perFile, [15, 15, 10]);
  const progress = [];
  const result = await runBatch({ files: list, readFile: readFileFromMap, onProgress: (p) => progress.push(p.phase),
    job: batchSummaryJob({ pdfjs, fontBytes, generatedAt: WHEN }) });
  assert.equal(result.cancelled, false);
  assert.deepEqual(result.log.map((e) => [e.name, e.ok]), [['A.pdf', true], ['B.pdf', true], ['broken.pdf', false], ['C.pdf', true]]);
  assert.ok(result.log[2].error, 'the corrupt file carries its error');
  assert.deepEqual(result.log.filter((e) => e.ok).map((e) => e.detail), [15, 15, 10]);
  assert.deepEqual(progress.filter((p) => p === 'done').length, 4);
  for (const [path, bytes] of files) assert.deepEqual(bytes, before.get(path), `${path} is not changed`);

  const { summary, outputs } = result.output;
  const total = perFile.reduce((a, b) => a + b, 0);
  assert.equal(total, 40);
  assert.equal(summary.rows.length, total);
  assert.deepEqual(outputs.map((o) => o.name), ['markups-summary-2026-10-14.csv', 'markups-summary-2026-10-14.xlsx', 'markups-summary-2026-10-14.pdf']);

  // CSV: header + one line per markup.
  const lines = csvLines(outputs[0].bytes);
  assert.equal(lines.length, total + 1);
  assert.match(lines[0], /^"File","Page Label","Page","Type","Subject","Status","Author","Date","Comments","Trade","Measurement","Value","Unit"$/u);
  const a = lines.filter((l) => l.startsWith('"A.pdf"'));
  assert.equal(a.length, 15);
  assert.ok(a.some((l) => l.includes('"A-101"')) && a.some((l) => l.includes('"A-102"')), 'page labels from the PDF');
  assert.ok(a.some((l) => l.includes('"Accepted"')), 'status label');
  assert.equal(a.filter((l) => l.includes('"Electrical"')).length, 6, 'custom column values');
  const calibrated = a.filter((l) => l.includes('"measureDistance"'));
  assert.equal(calibrated.length, 3);
  for (const l of calibrated) assert.match(l, /"\d+(\.\d+)? mm","\d+(\.\d+)?","mm"$/u);
  const b = lines.filter((l) => l.startsWith('"B.pdf"') && l.includes('"measureDistance"'));
  assert.equal(b.length, 2);
  for (const l of b) assert.match(l, /"Scale not set[^"]*pt","",""$/u, 'uncalibrated stays Scale not set, no physical value');
  assert.ok(lines.filter((l) => l.startsWith('"C.pdf"')).every((l) => l.includes(`"'=HYPERLINK(""x"")"`)), 'formula cells are neutralised');
  assert.ok(!lines.some((l) => l.includes('broken.pdf')));

  // XLSX: Markups sheet has the same rows; Totals and Files sheets exist.
  const parts = await unzip(outputs[1].bytes);
  const text = (name) => new TextDecoder().decode(parts.get(name));
  assert.match(text('xl/workbook.xml'), /name="Markups".*name="Totals".*name="Files"/u);
  assert.equal((text('xl/worksheets/sheet1.xml').match(/<row /gu) || []).length, total + 1);
  assert.match(text('xl/worksheets/sheet3.xml'), /broken\.pdf.*Failed/u);
  assert.match(text('xl/worksheets/sheet2.xml'), /Scale not set: 2/u);

  // PDF: reopens; every markup row names its file once, the Totals and Files tables once each.
  const task = pdfjs.getDocument({ data: outputs[2].bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const items = [];
  for (let n = 1; n <= doc.numPages; n++) items.push(...(await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str));
  await task.destroy();
  assert.ok(doc.numPages >= 2, 'the table is paginated');
  for (const [name, count] of [['A.pdf', 15], ['B.pdf', 15], ['C.pdf', 10]]) {
    assert.equal(items.filter((s) => s === name).length, count + 2, `${name} rows in the PDF`);
  }
  const joined = items.join(' ');
  assert.match(joined, /Totals by File/u);
  assert.match(joined, /Not included: broken\.pdf/u);
  assert.match(joined, /Scale not set/u);
  assert.match(joined, new RegExp(`Page 1 of ${doc.numPages}`, 'u'));
});

test('sorting by subject groups rows and totals per subject', async () => {
  const result = await runBatch({ files: list, readFile: readFileFromMap,
    job: batchSummaryJob({ pdfjs, fontBytes, sortBy: 'subject', formats: ['xlsx'], generatedAt: WHEN }) });
  const { summary, outputs } = result.output;
  assert.equal(outputs.length, 1);
  const subjects = summary.rows.map((r) => r.subject);
  const named = subjects.filter(Boolean);
  assert.deepEqual(named, [...named].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' })));
  assert.deepEqual(subjects.slice(named.length), ['', ''], 'markups without a subject come last');
  assert.equal(subjects.filter((s) => s === 'Length').length, 3, 'a measurement keeps its subject');
  const parts = await unzip(outputs[0].bytes);
  const totals = new TextDecoder().decode(parts.get('xl/worksheets/sheet2.xml'));
  assert.match(totals, />Subject</u);
  assert.match(totals, />\(none\)<.*?<v>2<\/v>/u, 'the 2 lengths of B have no subject');
  assert.match(totals, />Total<.*?<v>40<\/v>/u);
});

test('cancel mid-run returns no output, and nothing is written', async () => {
  const controller = new AbortController();
  let finished = false;
  const job = batchSummaryJob({ pdfjs, fontBytes, generatedAt: WHEN });
  const finish = job.finish;
  job.finish = async (...args) => { finished = true; return finish(...args); };
  const result = await runBatch({ files: list, readFile: readFileFromMap, job, signal: controller.signal,
    onProgress: (p) => { if (p.phase === 'done' && p.index === 0) controller.abort(); } });
  assert.equal(result.cancelled, true);
  assert.equal(result.output, null);
  assert.equal(finished, false, 'the outputs were never built');
  assert.equal(result.log.length, 1);
  const writes = [];
  if (!result.cancelled) await writeBatchOutputs(result.output.outputs, { write: async (p) => writes.push(p) });
  assert.equal(writes.length, 0);
});

test('a measurement without stored text or scale does not take the active document scale', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const ctx = doc.context;
  const line = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Line', Rect: [100, 100, 200, 110], L: [100, 100, 200, 100],
    IT: PDFName.of('LineDimension'), C: [1, 0, 0], T: PDFHexString.fromText('Other app') }));
  page.node.set(PDFName.of('Annots'), ctx.obj([line]));
  openDocument(MM_100, [], 1);
  const [row] = fileSummaryRows(await readPdfMarkups(await doc.save(), { pdfjs }), { file: 'other.pdf' });
  assert.equal(row.type, 'measureDistance');
  assert.equal(row.calibrated, false);
  assert.equal(row.value, null);
  assert.match(row.measurement, /^Scale not set · 100 pt$/u);
});
