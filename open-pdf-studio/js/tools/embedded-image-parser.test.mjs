// Node test for the embedded image-XObject parser (issue #184).
// Run: node js/tools/embedded-image-parser.test.mjs
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  parsePageImages, blankImageRange, bboxFromCtm, collectContentText,
} from './embedded-image-parser.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok  -', msg); }
  else { console.error('  FAIL-', msg); failures++; }
}

// 1x1 red PNG.
const PNG_1x1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'));

async function buildDoc(numImages) {
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(PNG_1x1);
  const page = pdf.addPage([200, 200]);
  // Draw two images at distinct spots; the first at x50 y60 w80 h40.
  page.drawImage(png, { x: 50, y: 60, width: 80, height: 40 });
  if (numImages > 1) page.drawImage(png, { x: 10, y: 150, width: 30, height: 30 });
  return new Uint8Array(await pdf.save());
}

async function run() {
  console.log('Test 1: detect a single embedded image');
  {
    const bytes = await buildDoc(1);
    const doc = await PDFDocument.load(bytes);
    const { images } = parsePageImages(doc, 1);
    assert(images.length === 1, `found exactly 1 image (got ${images.length})`);

    // Y-flip viewport transform for a 200-pt-tall page at scale 1.
    const vt = [1, 0, 0, -1, 0, 200];
    const bbox = bboxFromCtm(images[0].ctm, vt);
    assert(Math.abs(bbox.x - 50) < 0.5 && Math.abs(bbox.width - 80) < 0.5,
      `bbox x/width ~ 50/80 (got ${bbox.x.toFixed(1)}/${bbox.width.toFixed(1)})`);
    assert(Math.abs(bbox.y - 100) < 0.5 && Math.abs(bbox.height - 40) < 0.5,
      `bbox y/height ~ 100/40 (got ${bbox.y.toFixed(1)}/${bbox.height.toFixed(1)})`);
  }

  console.log('Test 2: remove the image via content-stream edit → gone after save');
  {
    const bytes = await buildDoc(1);
    const doc = await PDFDocument.load(bytes);
    const context = doc.context;
    const parsed = parsePageImages(doc, 1);
    assert(parsed.images.length === 1, 'starts with 1 image');

    const newText = blankImageRange(parsed.text, parsed.images[0]);
    assert(!/\bDo\b/.test(newText) || newText.indexOf('Do') !== parsed.text.indexOf('Do'),
      'the Do operator was blanked in the content string');

    const newStream = context.flateStream(newText);
    const newRef = context.register(newStream);
    doc.getPage(0).node.set(PDFName.of('Contents'), newRef);
    const savedBytes = new Uint8Array(await doc.save());

    const reloaded = await PDFDocument.load(savedBytes);
    const after = parsePageImages(reloaded, 1);
    assert(after.images.length === 0, `no image draws after removal (got ${after.images.length})`);
    // Sanity: the saved PDF is still parseable and has one page.
    assert(reloaded.getPageCount() === 1, 'saved PDF still has 1 page');
  }

  console.log('Test 3: two images → removing index 0 leaves index 1');
  {
    const bytes = await buildDoc(2);
    const doc = await PDFDocument.load(bytes);
    const context = doc.context;
    const parsed = parsePageImages(doc, 1);
    assert(parsed.images.length === 2, `starts with 2 images (got ${parsed.images.length})`);

    const newText = blankImageRange(parsed.text, parsed.images[0]);
    const newStream = context.flateStream(newText);
    doc.getPage(0).node.set(PDFName.of('Contents'), context.register(newStream));
    const savedBytes = new Uint8Array(await doc.save());

    const reloaded = await PDFDocument.load(savedBytes);
    const after = parsePageImages(reloaded, 1);
    assert(after.images.length === 1, `exactly 1 image remains (got ${after.images.length})`);
  }

  console.log('');
  if (failures === 0) console.log('ALL PASS');
  else { console.error(`${failures} FAILURE(S)`); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(1); });
