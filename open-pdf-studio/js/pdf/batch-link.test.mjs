// Batch Link: reference matching rules, and the whole path on real PDF bytes:
// page text -> planned links -> hyperlink markups -> the app's saver -> /Link
// with a /Dest and the Batch Link marker -> reopen as the same markups. The
// page labels written before survive the save.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

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
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const {
  linkTargetsFromLabels, referenceMatcher, planBatchLinks, batchLinkMarkup, isBatchLinkMarkup,
} = await import('./batch-link.js');
const { modelViewport, textItemBox } = await import('./region-text.js');
const { writePageLabels } = await import('./page-labels.js');

const LABELS = ['A-101', 'A-102', 'A-103'];

test('targets skip blank, numeric and duplicate labels', () => {
  const { targets, ambiguous } = linkTargetsFromLabels(['A-101', '2', '', 'S2.01', 'S2.01', 'E-1']);
  assert.deepEqual([...targets], [['A-101', 1], ['E-1', 6]]);
  assert.deepEqual(ambiguous, [{ label: 'S2.01', pages: [4, 5] }]);
});

test('references match on word boundaries, detail callouts and case options', () => {
  const { targets } = linkTargetsFromLabels(['A-101', 'A-102', 'S2.01', 'A-1']);
  const m = referenceMatcher(targets, {});
  const found = (text, matcher = m) => matcher.find(text).map(h => [h.text, h.label, h.page, h.callout]);
  assert.deepEqual(found('SEE A-102 AND 3/A-101.'), [['A-102', 'A-102', 2, false], ['3/A-101', 'A-101', 1, true]]);
  // Longest label wins; a label inside a longer code is no reference.
  assert.deepEqual(found('A-1010 XA-101 A-1 A-101B'), [['A-1', 'A-1', 4, false]]);
  assert.deepEqual(found('ref s2.01, 12 / S2.01'), [['s2.01', 'S2.01', 3, false], ['12 / S2.01', 'S2.01', 3, true]]);
  const strict = referenceMatcher(targets, { caseSensitive: true });
  assert.deepEqual(found('a-101 A-101', strict), [['A-101', 'A-101', 1, false]]);
  const loose = referenceMatcher(targets, { wholeWord: false, callouts: false });
  assert.deepEqual(found('XA-101', loose), [['A-101', 'A-101', 1, false]]);
});

test('the plan leaves out self-links and places already linked', () => {
  const box = (x) => () => ({ x, y: 10, width: 30, height: 10 });
  const pages = [
    { page: 1, items: [{ str: 'A-101', box: box(0) }, { str: 'SEE A-102', box: box(50) }] },
    { page: 2, items: [{ str: '5/A-101', box: box(0) }] },
    { page: 3, items: [] },
  ];
  const existing = [{ page: 2, x: 0, y: 10, width: 30, height: 10 }];
  const plan = planBatchLinks(pages, ['A-101', 'A-102', 'A-103'], { existing });
  assert.deepEqual(plan.links.map(l => [l.page, l.text, l.targetPage]), [[1, 'A-102', 2]]);
  assert.deepEqual(plan.skipped.map(s => [s.page, s.text, s.reason]), [[1, 'A-101', 'self'], [2, '5/A-101', 'existing']]);
  assert.deepEqual(plan.pagesWithoutText, [3]);
  const withSelf = planBatchLinks(pages, ['A-101', 'A-102', 'A-103'], { excludeSelf: false });
  assert.equal(withSelf.links.length, 3);
});

async function sheetSet() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  LABELS.forEach((label, i) => {
    const page = pdf.addPage([792, 612]);
    page.setCropBox(10, 20, 772, 582);
    page.drawText(label, { x: 680, y: 40, size: 16, font });
    page.drawText(i === 0 ? 'SEE A-103' : 'SEE A-101', { x: 60, y: 500, size: 12, font });
    page.drawText(i === 2 ? 'DETAIL 3/A-102' : 'DETAIL 5/A-103', { x: 60, y: 460, size: 12, font });
  });
  writePageLabels(pdf, LABELS);
  return pdf.save();
}

async function pagesWithText(doc) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = modelViewport(page);
    const items = (await page.getTextContent()).items.map(item => ({ str: item.str, box: (s, e) => textItemBox(item, vp, s, e) }));
    pages.push({ page: p, items });
  }
  return pages;
}

async function save(bytes, annotations) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  state.documents = [{ id: 'batch-link', filePath: 'C:/sets/input.pdf', pdfDoc: {},
    annotations, pageRotations: {}, _annotationPagesReady: new Set([1, 2, 3]), textEdits: [] }];
  state.activeDocumentIndex = 0;
  assert.equal(await savePDF('C:/sets/output.pdf', { zonderHandtekeningVraag: true }), true);
  return saved;
}

test('batch links save as /Link with /Dest and come back as Batch Link markups', async () => {
  const source = await sheetSet();
  const task = pdfjs.getDocument({ data: source.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  let plan;
  try {
    plan = planBatchLinks(await pagesWithText(doc), await doc.getPageLabels(), {});
  } finally {
    await task.destroy();
  }
  assert.deepEqual(plan.links.map(l => [l.page, l.text, l.targetPage]), [
    [1, 'A-103', 3], [1, '5/A-103', 3], [2, 'A-101', 1], [2, '5/A-103', 3], [3, 'A-101', 1], [3, '3/A-102', 2],
  ]);
  // The title-block numbers are self-references.
  assert.deepEqual(plan.skipped.map(s => [s.page, s.reason]), [[1, 'self'], [2, 'self'], [3, 'self']]);
  // "SEE A-103" on page 1: the link frames "A-103" only, at the text in model space
  // (PDF x 60, y 500 -> model x 50, baseline y 102 with the CropBox at 10, 20 + 582).
  const first = plan.links[0].rect;
  assert.ok(first.x > 50 + 20 && first.x < 50 + 40, `x ${first.x}`);
  assert.ok(Math.abs(first.y + first.height * 0.8 - (602 - 500)) < 2, `y ${first.y}`);

  const markups = plan.links.map(l => createAnnotation(batchLinkMarkup(l, { color: '#e11d48', lineWidth: 2 })));
  // A hand-made hyperlink stays when the batch links are removed.
  const manual = createAnnotation({ type: 'hyperlink', page: 2, x: 5, y: 5, width: 40, height: 12, linkUrl: 'https://example.com', color: '#2563eb', lineWidth: 1 });
  const saved = await save(source, [...markups, manual]);

  const raw = await PDFDocument.load(saved);
  const ctx = raw.context;
  const links = raw.getPages().flatMap((page, i) => {
    const annots = ctx.lookup(page.node.get(PDFName.of('Annots')));
    return (annots ? annots.asArray() : []).map(ref => ({ page: i + 1, dict: ctx.lookup(ref) }));
  }).filter(({ dict }) => dict.get(PDFName.of('Subtype'))?.toString() === '/Link');
  assert.equal(links.length, 7);
  const batch = links.filter(({ dict }) => dict.get(PDFName.of('OPS_BatchLink'))?.toString() === 'true');
  assert.equal(batch.length, 6);
  const pageRefs = raw.getPages().map(p => p.ref);
  const dest = batch[0].dict.lookup(PDFName.of('Dest'));
  assert.equal(dest.get(0), pageRefs[2], 'page 1 "A-103" points at page 3');
  assert.equal(batch[0].dict.lookup(PDFName.of('BS')).lookup(PDFName.of('W')).asNumber(), 2);

  // Labels written before the save are still there.
  const reopenTask = pdfjs.getDocument({ data: saved.slice(), isEvalSupported: false, verbosity: 0 });
  const reopened = await reopenTask.promise;
  try {
    assert.deepEqual(await reopened.getPageLabels(), LABELS);
    const models = [];
    for (let p = 1; p <= 3; p++) {
      const page = await reopened.getPage(p);
      const colors = await extractAnnotationColors(p, await PDFDocument.load(saved.slice()));
      for (const a of await page.getAnnotations()) {
        if (a.subtype === 'Link') assert.ok(Array.isArray(a.dest) || a.url, 'PDF.js follows it');
        const model = await convertPdfAnnotation(a, p, page.getViewport({ scale: 1 }), new Map(), colors);
        if (model) models.push(model);
      }
    }
    const back = models.filter(isBatchLinkMarkup);
    assert.equal(back.length, 6);
    assert.deepEqual(back.map(m => [m.page, m.linkPage]), [[1, 3], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2]]);
    assert.equal(back[0].linkBorder, 2);
    assert.equal(back[0].color.toLowerCase(), '#e11d48');
    assert.ok(Math.abs(back[0].x - markups[0].x) < 0.5 && Math.abs(back[0].y - markups[0].y) < 0.5);
    const kept = models.filter(m => m.type === 'hyperlink' && !isBatchLinkMarkup(m));
    assert.equal(kept.length, 1);
    assert.equal(kept[0].linkBorder, 0);

    // Remove: save again without the batch links; the manual link remains.
    const again = await save(saved, kept);
    const left = await PDFDocument.load(again);
    const count = left.getPages().reduce((n, page) => n + (left.context.lookup(page.node.get(PDFName.of('Annots')))?.size() || 0), 0);
    assert.equal(count, 1);
  } finally {
    await reopenTask.destroy();
  }
});
