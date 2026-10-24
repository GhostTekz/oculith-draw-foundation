import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const sheet = fixture.addPage([612, 792]);
sheet.setCropBox(36, 40, 540, 720);
sheet.setRotation(degrees(90));
const input = new Uint8Array(await fixture.save());
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-durable-box-id-'));
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });

  const load = async (bytes, name, add = false) => {
    await page.evaluate(async ({ bytes, name, add }) => {
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { goToPage } = await import('/js/pdf/renderer.js');
      const { state } = await import('/js/core/state.ts');
      const { createAnnotation } = await import('/js/annotations/factory.js');
      const { index } = createTab(name);
      await loadPDF(name, index, Uint8Array.from(bytes));
      await goToPage(2);
      const doc = state.documents[index];
      if (add) {
        for (const [id, subject, color] of [
          ['fixture-a', 'Box A', '#e87524'],
          ['fixture-b', 'Box B', '#123abc'],
        ]) {
          doc.annotations.push(createAnnotation({ id, page: 2, type: 'box', x: 100, y: 100,
            width: 80, height: 40, color, strokeColor: color, lineWidth: 2, subject }));
        }
      }
    }, { bytes: Array.from(bytes), name, add });
    await page.waitForFunction(async () => (await import('/js/core/state.ts'))
      .getActiveDocument()?._annotationPagesReady?.has(2));
  };

  const modelIds = async () => page.evaluate(async () => Object.fromEntries(
    (await import('/js/core/state.ts')).getActiveDocument().annotations
      .filter(ann => ann.page === 2 && ann.type === 'box')
      .map(ann => [ann.subject, ann.id])));

  const save = async () => {
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await download).path()));
  };

  const pdfBoxes = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const boxes = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)))
      .filter(dict => dict.get(PDFName.of('OPS_MarkupIdV1')));
    return { pdf, boxes, ids: Object.fromEntries(boxes.map(dict => [
      dict.get(PDFName.of('Contents')).decodeText(),
      dict.get(PDFName.of('OPS_MarkupIdV1')).decodeText(),
    ])) };
  };

  await load(input, 'box-source.pdf', true);
  const expected = { 'Box A': 'fixture-a', 'Box B': 'fixture-b' };
  assert.deepEqual(await modelIds(), expected);
  const first = await save();
  const firstPdf = await pdfBoxes(first);
  assert.deepEqual(firstPdf.ids, expected);
  assert.equal(firstPdf.boxes.length, 2);
  assert.equal(firstPdf.boxes[0].get(PDFName.of('Rect')).toString(),
    firstPdf.boxes[1].get(PDFName.of('Rect')).toString(), 'distinct boxes share exact /Rect');

  await load(first, 'box-first.pdf');
  assert.deepEqual(await modelIds(), expected);
  const second = await save();
  assert.deepEqual((await pdfBoxes(second)).ids, expected);
  await load(second, 'box-second.pdf');
  assert.deepEqual(await modelIds(), expected);

  // Internal copy and paste must mint a separate identity for the new box.
  const copiedId = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { copyAnnotation, pasteAnnotation } = await import('/js/annotations/clipboard.js');
    const doc = getActiveDocument();
    copyAnnotation(doc.annotations.find(ann => ann.subject === 'Box A'));
    pasteAnnotation();
    const copy = doc.selectedAnnotation;
    copy.subject = 'Copy A';
    return copy.id;
  });
  assert.notEqual(copiedId, 'fixture-a');
  assert.deepEqual(await modelIds(), { ...expected, 'Copy A': copiedId });
  const copied = await save();
  assert.deepEqual((await pdfBoxes(copied)).ids, { ...expected, 'Copy A': copiedId });
  await load(copied, 'box-copy.pdf');
  assert.deepEqual(await modelIds(), { ...expected, 'Copy A': copiedId });

  // A copied PDF annotation can carry a duplicate private key. The second
  // annotation must get a fresh ID, then keep it on the next save/reopen.
  const forgedPdf = await PDFDocument.load(first.slice());
  const forgedAnnots = forgedPdf.getPage(1).node.Annots();
  forgedPdf.context.lookup(forgedAnnots.get(1))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('fixture-a'));
  await load(new Uint8Array(await forgedPdf.save()), 'box-forged.pdf');
  const repaired = await modelIds();
  assert.equal(repaired['Box A'], 'fixture-a');
  assert.notEqual(repaired['Box B'], 'fixture-a');
  assert.notEqual(repaired['Box B'], 'fixture-b');
  const repairedBytes = await save();
  assert.deepEqual((await pdfBoxes(repairedBytes)).ids, repaired);
  await load(repairedBytes, 'box-repaired.pdf');
  assert.deepEqual(await modelIds(), repaired);

  // Oversized text from an untrusted PDF is ignored before decode; it must
  // not leak the overlapping neighbour's ID through the /Rect fallback.
  const oversizedPdf = await PDFDocument.load(first.slice());
  const oversizedAnnots = oversizedPdf.getPage(1).node.Annots();
  oversizedPdf.context.lookup(oversizedAnnots.get(1))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('x'.repeat(500)));
  await load(new Uint8Array(await oversizedPdf.save()), 'box-oversized.pdf');
  const bounded = await modelIds();
  assert.equal(bounded['Box A'], 'fixture-a');
  assert.notEqual(bounded['Box B'], 'fixture-a');
  assert.notEqual(bounded['Box B'], 'fixture-b');

  // Two on-demand page loads may convert at the same time. A collision check
  // taken before their awaits lets both pages publish the same model ID.
  const concurrentPdf = await PDFDocument.load(first.slice());
  const third = concurrentPdf.addPage([612, 792]);
  third.setCropBox(36, 40, 540, 720);
  third.setRotation(degrees(90));
  const firstBox = concurrentPdf.context.lookup(concurrentPdf.getPage(1).node.Annots().get(0));
  const pageCopy = concurrentPdf.context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: firstBox.get(PDFName.of('Rect')),
    C: [0, 0, 1], F: 4, T: PDFString.of('User'), Contents: PDFString.of('Box C'),
    OPS_MarkupIdV1: PDFString.of('fixture-a'),
  });
  third.node.set(PDFName.of('Annots'), concurrentPdf.context.obj([
    concurrentPdf.context.register(pageCopy),
  ]));
  await load(new Uint8Array(await concurrentPdf.save()), 'box-parallel.pdf');
  await page.waitForFunction(async () => (await import('/js/core/state.ts'))
    .getActiveDocument()?._annotationPagesReady?.has(3));
  const concurrent = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { cancelAnnotationLoading, ensureAnnotationsForPage } = await import('/js/pdf/loader.js');
    const doc = getActiveDocument();
    cancelAnnotationLoading(doc);
    doc.annotations = [];
    await Promise.all([ensureAnnotationsForPage(2, doc), ensureAnnotationsForPage(3, doc)]);
    return doc.annotations.filter(ann => ann.type === 'box')
      .map(ann => [ann.page, ann.subject, ann.id]);
  });
  assert.equal(concurrent.length, 3);
  assert.equal(new Set(concurrent.map(([, , id]) => id)).size, 3,
    'parallel pages must publish distinct model IDs');
  assert.equal(concurrent.find(([, subject]) => subject === 'Box B')?.[2], 'fixture-b');
  assert.equal(concurrent.filter(([, , id]) => id === 'fixture-a').length, 1);
  assert.deepEqual(errors, []);
  console.log('Durable box IDs passed: rotated CropBox, overlapping Rects, two saves/reopens, copy, malformed keys, parallel pages');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
