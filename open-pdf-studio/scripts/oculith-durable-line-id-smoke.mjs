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
const directory = await mkdtemp(join(tmpdir(), 'ocudraw-durable-line-id-'));
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
        for (const [id, subject, type, color] of [
          ['line-a', 'Line A', 'line', '#e87524'],
          ['line-b', 'Line B', 'line', '#123abc'],
          ['arrow-c', 'Arrow C', 'arrow', '#007766'],
        ]) {
          doc.annotations.push(createAnnotation({ id, page: 2, type,
            startX: 100, startY: 110, endX: 190, endY: 155,
            color, strokeColor: color, lineWidth: 2, subject,
            ...(type === 'arrow' ? { startHead: 'none', endHead: 'open', headSize: 8 } : {}),
          }));
        }
      }
    }, { bytes: Array.from(bytes), name, add });
    await page.waitForFunction(async () => (await import('/js/core/state.ts'))
      .getActiveDocument()?._annotationPagesReady?.has(2));
  };

  const model = async () => page.evaluate(async () => Object.fromEntries(
    (await import('/js/core/state.ts')).getActiveDocument().annotations
      .filter(ann => ann.page === 2 && ['line', 'arrow'].includes(ann.type))
      .map(ann => [ann.subject, { id: ann.id, type: ann.type }])));

  const save = async () => {
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.evaluate(async () => (await import('/js/pdf/saver.js')).savePDF());
    return new Uint8Array(await readFile(await (await download).path()));
  };

  const pdfLines = async bytes => {
    const pdf = await PDFDocument.load(bytes.slice());
    assert.deepEqual(pdf.getPage(1).getCropBox(), { x: 36, y: 40, width: 540, height: 720 });
    assert.equal(pdf.getPage(1).getRotation().angle, 90);
    const refs = pdf.getPage(1).node.Annots();
    assert.ok(refs instanceof PDFArray);
    const lines = Array.from({ length: refs.size() }, (_, i) => pdf.context.lookup(refs.get(i)))
      .filter(dict => dict.get(PDFName.of('OPS_MarkupIdV1')));
    return { pdf, lines, ids: Object.fromEntries(lines.map(dict => [
      dict.get(PDFName.of('Contents')).decodeText(),
      dict.get(PDFName.of('OPS_MarkupIdV1')).decodeText(),
    ])) };
  };

  await load(input, 'line-source.pdf', true);
  const expected = {
    'Line A': { id: 'line-a', type: 'line' },
    'Line B': { id: 'line-b', type: 'line' },
    'Arrow C': { id: 'arrow-c', type: 'arrow' },
  };
  assert.deepEqual(await model(), expected);
  const first = await save();
  const firstPdf = await pdfLines(first);
  assert.deepEqual(firstPdf.ids, { 'Line A': 'line-a', 'Line B': 'line-b', 'Arrow C': 'arrow-c' });
  assert.equal(firstPdf.lines.length, 3);
  assert.equal(firstPdf.lines[0].get(PDFName.of('Rect')).toString(),
    firstPdf.lines[1].get(PDFName.of('Rect')).toString(), 'distinct lines share exact /Rect');
  assert.equal(firstPdf.lines[0].get(PDFName.of('L')).toString(),
    firstPdf.lines[1].get(PDFName.of('L')).toString(), 'distinct lines share exact /L');
  await load(first, 'line-first.pdf');
  assert.deepEqual(await model(), expected);
  const second = await save();
  assert.deepEqual((await pdfLines(second)).ids, firstPdf.ids);
  await load(second, 'line-second.pdf');
  assert.deepEqual(await model(), expected);

  const copyId = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { copyAnnotation, pasteAnnotation } = await import('/js/annotations/clipboard.js');
    const doc = getActiveDocument();
    copyAnnotation(doc.annotations.find(ann => ann.subject === 'Arrow C'));
    pasteAnnotation();
    doc.selectedAnnotation.subject = 'Arrow copy';
    return doc.selectedAnnotation.id;
  });
  assert.notEqual(copyId, 'arrow-c');
  const copied = await save();
  assert.equal((await pdfLines(copied)).ids['Arrow copy'], copyId);
  await load(copied, 'line-copy.pdf');
  assert.deepEqual((await model())['Arrow copy'], { id: copyId, type: 'arrow' });

  const forgedPdf = await PDFDocument.load(first.slice());
  const forgedAnnots = forgedPdf.getPage(1).node.Annots();
  forgedPdf.context.lookup(forgedAnnots.get(1))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('line-a'));
  await load(new Uint8Array(await forgedPdf.save()), 'line-forged.pdf');
  const repaired = await model();
  assert.equal(repaired['Line A'].id, 'line-a');
  assert.notEqual(repaired['Line B'].id, 'line-a');
  assert.notEqual(repaired['Line B'].id, 'line-b');
  const repairedBytes = await save();
  assert.equal((await pdfLines(repairedBytes)).ids['Line B'], repaired['Line B'].id);
  await load(repairedBytes, 'line-repaired.pdf');
  assert.deepEqual(await model(), repaired);

  const malformedPdf = await PDFDocument.load(first.slice());
  const malformedAnnots = malformedPdf.getPage(1).node.Annots();
  malformedPdf.context.lookup(malformedAnnots.get(1))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('x'.repeat(500)));
  malformedPdf.context.lookup(malformedAnnots.get(2))
    .set(PDFName.of('OPS_MarkupIdV1'), PDFString.of('../bad'));
  await load(new Uint8Array(await malformedPdf.save()), 'line-malformed.pdf');
  const bounded = await model();
  assert.equal(bounded['Line A'].id, 'line-a');
  assert.notEqual(bounded['Line B'].id, 'line-a');
  assert.notEqual(bounded['Line B'].id, 'line-b');
  assert.notEqual(bounded['Arrow C'].id, 'arrow-c');
  assert.notEqual(bounded['Arrow C'].id, 'line-a');

  const concurrentPdf = await PDFDocument.load(first.slice());
  const third = concurrentPdf.addPage([612, 792]);
  third.setCropBox(36, 40, 540, 720);
  third.setRotation(degrees(90));
  const firstLine = concurrentPdf.context.lookup(concurrentPdf.getPage(1).node.Annots().get(0));
  const pageCopy = concurrentPdf.context.obj({
    Type: 'Annot', Subtype: 'Line', Rect: firstLine.get(PDFName.of('Rect')),
    L: firstLine.get(PDFName.of('L')), C: [0, 0, 1], F: 4,
    T: PDFString.of('User'), Contents: PDFString.of('Line D'),
    OPS_MarkupIdV1: PDFString.of('line-a'),
  });
  third.node.set(PDFName.of('Annots'), concurrentPdf.context.obj([
    concurrentPdf.context.register(pageCopy),
  ]));
  await load(new Uint8Array(await concurrentPdf.save()), 'line-parallel.pdf');
  await page.waitForFunction(async () => (await import('/js/core/state.ts'))
    .getActiveDocument()?._annotationPagesReady?.has(3));
  const concurrent = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { cancelAnnotationLoading, ensureAnnotationsForPage } = await import('/js/pdf/loader.js');
    const doc = getActiveDocument();
    cancelAnnotationLoading(doc);
    doc.annotations = [];
    await Promise.all([ensureAnnotationsForPage(2, doc), ensureAnnotationsForPage(3, doc)]);
    return doc.annotations.filter(ann => ['line', 'arrow'].includes(ann.type))
      .map(ann => [ann.page, ann.subject, ann.id]);
  });
  assert.equal(concurrent.length, 4);
  assert.equal(new Set(concurrent.map(([, , id]) => id)).size, 4,
    'parallel pages must publish distinct line/arrow IDs');
  assert.equal(concurrent.filter(([, , id]) => id === 'line-a').length, 1,
    JSON.stringify(concurrent));
  assert.deepEqual(errors, []);
  console.log('Durable line/arrow IDs passed: rotated CropBox, overlapping geometry, two saves/reopens, copy, malformed keys, parallel pages');
} finally {
  await browser.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
