import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFString, degrees } from 'pdf-lib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = await PDFDocument.create();
fixture.addPage([612, 792]);
const sheet = fixture.addPage([612, 792]);
sheet.setCropBox(36, 40, 540, 720);
sheet.setRotation(degrees(90));
const input = new Uint8Array(await fixture.save());
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-durable-circle-id-'));
const server = await createServer({ cacheDir: join(directory, 'vite-cache'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false }, logLevel: 'error' });
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
        for (const [id, subject, width, height, color] of [
          ['ellipse-a', 'Ellipse A', 80, 40, '#e87524'],
          ['ellipse-b', 'Ellipse B', 80, 40, '#123abc'],
          ['circle-c', 'Circle C', 50, 50, '#007766'],
        ]) {
          doc.annotations.push(createAnnotation({ id, page: 2, type: 'circle',
            x: 100, y: 110, width, height, color, strokeColor: color,
            lineWidth: 2, subject,
          }));
        }
      }
    }, { bytes: Array.from(bytes), name, add });
    await page.waitForFunction(async () => (await import('/js/core/state.ts'))
      .getActiveDocument()?._annotationPagesReady?.has(2));
  };

  const model = async () => page.evaluate(async () => Object.fromEntries(
    (await import('/js/core/state.ts')).getActiveDocument().annotations
      .filter(ann => ann.page === 2 && ann.type === 'circle')
      .map(ann => [ann.subject, { id: ann.id, width: ann.width, height: ann.height }])));

  const save = async () => {
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await download).path()));
  };

  const pdfCircles = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const circles = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)))
      .filter(dict => dict.get(PDFName.of('OPS_MarkupIdV1')));
    return { pdf, circles, ids: Object.fromEntries(circles.map(dict => [
      dict.get(PDFName.of('Contents')).decodeText(),
      dict.get(PDFName.of('OPS_MarkupIdV1')).decodeText(),
    ])) };
  };

  await load(input, 'circle-source.pdf', true);
  const expected = {
    'Ellipse A': { id: 'ellipse-a', width: 80, height: 40 },
    'Ellipse B': { id: 'ellipse-b', width: 80, height: 40 },
    'Circle C': { id: 'circle-c', width: 50, height: 50 },
  };
  assert.deepEqual(await model(), expected);
  const first = await save();
  const firstPdf = await pdfCircles(first);
  assert.deepEqual(firstPdf.ids, { 'Ellipse A': 'ellipse-a', 'Ellipse B': 'ellipse-b', 'Circle C': 'circle-c' });
  assert.equal(firstPdf.circles.length, 3);
  assert.equal(firstPdf.circles[0].get(PDFName.of('Rect')).toString(),
    firstPdf.circles[1].get(PDFName.of('Rect')).toString(), 'distinct ellipses share exact /Rect');
  await load(first, 'circle-first.pdf');
  assert.deepEqual(await model(), expected);
  const second = await save();
  assert.deepEqual((await pdfCircles(second)).ids, firstPdf.ids);
  await load(second, 'circle-second.pdf');
  assert.deepEqual(await model(), expected);

  const copyId = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { copyAnnotation, pasteAnnotation } = await import('/js/annotations/clipboard.js');
    const doc = getActiveDocument();
    copyAnnotation(doc.annotations.find(ann => ann.subject === 'Circle C'));
    pasteAnnotation();
    doc.selectedAnnotation.subject = 'Circle copy';
    return doc.selectedAnnotation.id;
  });
  assert.notEqual(copyId, 'circle-c');
  const copied = await save();
  assert.equal((await pdfCircles(copied)).ids['Circle copy'], copyId);
  await load(copied, 'circle-copy.pdf');
  assert.equal((await model())['Circle copy'].id, copyId);

  const forgedPdf = await PDFDocument.load(first.slice());
  const forgedAnnots = forgedPdf.getPage(1).node.Annots();
  forgedPdf.context.lookup(forgedAnnots.get(1))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('ellipse-a'));
  await load(new Uint8Array(await forgedPdf.save()), 'circle-forged.pdf');
  const repaired = await model();
  assert.equal(repaired['Ellipse A'].id, 'ellipse-a');
  assert.notEqual(repaired['Ellipse B'].id, 'ellipse-a');
  assert.notEqual(repaired['Ellipse B'].id, 'ellipse-b');
  const repairedBytes = await save();
  assert.equal((await pdfCircles(repairedBytes)).ids['Ellipse B'], repaired['Ellipse B'].id);
  await load(repairedBytes, 'circle-repaired.pdf');
  assert.deepEqual(await model(), repaired);

  const malformedPdf = await PDFDocument.load(first.slice());
  const malformedAnnots = malformedPdf.getPage(1).node.Annots();
  malformedPdf.context.lookup(malformedAnnots.get(1))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('x'.repeat(500)));
  malformedPdf.context.lookup(malformedAnnots.get(2))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('../bad'));
  await load(new Uint8Array(await malformedPdf.save()), 'circle-malformed.pdf');
  const bounded = await model();
  assert.equal(bounded['Ellipse A'].id, 'ellipse-a');
  assert.notEqual(bounded['Ellipse B'].id, 'ellipse-a');
  assert.notEqual(bounded['Ellipse B'].id, 'ellipse-b');
  assert.notEqual(bounded['Circle C'].id, 'circle-c');
  assert.notEqual(bounded['Circle C'].id, 'ellipse-a');

  for (const [label, rawSubtype, savedSubtype] of [
    ['named', PDFString.of('specialty'), 'specialty'],
    ['empty', PDFString.of(''), ''],
    ['malformed', PDFNumber.of(17), ''],
  ]) {
    const specialtyPdf = await PDFDocument.load(first.slice());
    specialtyPdf.context.lookup(specialtyPdf.getPage(1).node.Annots().get(2))
      .set(PDFName.of('OPS_Subtype'), rawSubtype);
    await load(new Uint8Array(await specialtyPdf.save()), `circle-specialty-${label}.pdf`);
    assert.notEqual((await model())['Circle C'].id, 'circle-c',
      `${label} specialty /Circle must not adopt the plain-shape ID`);
    for (let saveIndex = 1; saveIndex <= 2; saveIndex++) {
      const saved = await save();
      const parsed = await PDFDocument.load(saved.slice());
      const refs = parsed.getPage(1).node.Annots();
      const circle = Array.from({ length: refs.size() }, (_, i) => parsed.context.lookup(refs.get(i)))
        .find(dict => dict.get(PDFName.of('Contents'))?.decodeText() === 'Circle C');
      assert.ok(circle, `${label} circle remains in saved PDF`);
      assert.equal(circle.get(PDFName.of('OPS_MarkupIdV1')), undefined,
        `${label} specialty must not gain a durable ID on save ${saveIndex}`);
      assert.equal(circle.get(PDFName.of('OPS_Subtype'))?.decodeText(), savedSubtype,
        `${label} subtype presence survives save ${saveIndex}`);
      await load(saved, `circle-specialty-${label}-saved-${saveIndex}.pdf`);
      assert.notEqual((await model())['Circle C'].id, 'circle-c');
    }
  }

  const concurrentPdf = await PDFDocument.load(first.slice());
  const third = concurrentPdf.addPage([612, 792]);
  third.setCropBox(36, 40, 540, 720);
  third.setRotation(degrees(90));
  const firstCircle = concurrentPdf.context.lookup(concurrentPdf.getPage(1).node.Annots().get(0));
  const pageCopy = concurrentPdf.context.obj({
    Type: 'Annot', Subtype: 'Circle', Rect: firstCircle.get(PDFName.of('Rect')),
    C: [0, 0, 1], F: 4, T: PDFString.of('User'), Contents: PDFString.of('Ellipse D'),
    OPS_MarkupIdV1: PDFString.of('ellipse-a'),
  });
  third.node.set(PDFName.of('Annots'), concurrentPdf.context.obj([
    concurrentPdf.context.register(pageCopy),
  ]));
  await load(new Uint8Array(await concurrentPdf.save()), 'circle-parallel.pdf');
  await page.waitForFunction(async () => (await import('/js/core/state.ts'))
    .getActiveDocument()?._annotationPagesReady?.has(3));
  const concurrent = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { cancelAnnotationLoading, ensureAnnotationsForPage } = await import('/js/pdf/loader.js');
    const doc = getActiveDocument();
    cancelAnnotationLoading(doc);
    doc.annotations = [];
    await Promise.all([ensureAnnotationsForPage(2, doc), ensureAnnotationsForPage(3, doc)]);
    return doc.annotations.filter(ann => ann.type === 'circle')
      .map(ann => [ann.page, ann.subject, ann.id]);
  });
  assert.equal(concurrent.length, 4);
  assert.equal(new Set(concurrent.map(([, , id]) => id)).size, 4,
    'parallel pages must publish distinct circle IDs');
  assert.equal(concurrent.filter(([, , id]) => id === 'ellipse-a').length, 1);
  assert.deepEqual(errors, []);
  console.log('Durable circle/ellipse IDs passed: rotated CropBox, overlap, copy, malformed IDs, empty/malformed subtype exclusion over two saves, parallel pages');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
