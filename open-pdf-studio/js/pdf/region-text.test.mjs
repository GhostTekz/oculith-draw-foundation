// Region text on real PDF bytes: a CropBox with a nonzero origin, /Rotate 90
// and the app's own extra page rotation. The title block number is placed
// in the bottom-right corner of the sheet as displayed; one region drawn on
// page 1 finds it on every page.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { modelViewport, regionFractions, regionOnPage, textInRegion, textItemBox, extractRegionTexts } from './region-text.js';

const SHEETS = [
  { rotate: 0, number: 'A-101' },
  { rotate: 90, number: 'A-102' },
  { rotate: 270, number: 'A-103' },
];
const MEDIA = [0, 0, 1000, 800];
const CROP = [100, 50, 900, 750]; // 800 x 700, origin (100, 50)

async function open(bytes) {
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, verbosity: 0 });
  return { doc: await task.promise, task };
}

async function blankPages() {
  const pdf = await PDFDocument.create();
  for (const sheet of SHEETS) {
    const page = pdf.addPage([MEDIA[2], MEDIA[3]]);
    page.setCropBox(CROP[0], CROP[1], CROP[2] - CROP[0], CROP[3] - CROP[1]);
    page.setRotation(degrees(sheet.rotate));
  }
  return pdf.save();
}

// Draw `text` so that it reads left to right on the displayed sheet, starting
// at display point (dx, dy) on its baseline.
function drawDisplayed(page, viewport, font, text, dx, dy, size, rotate) {
  const [x, y] = viewport.convertToPdfPoint(dx, dy);
  page.drawText(text, { x, y, size, font, rotate: degrees(rotate) });
}

async function sheetsPdf() {
  // Pass 1: the display geometry of each page (PDF.js viewport).
  const { doc, task } = await open(await blankPages());
  const viewports = [];
  for (let p = 1; p <= doc.numPages; p++) viewports.push(modelViewport(await doc.getPage(p)));
  await task.destroy();

  const pdf = await PDFDocument.load(await blankPages());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.getPages().forEach((page, i) => {
    const vp = viewports[i];
    const rot = SHEETS[i].rotate;
    // Title block: bottom-right of the displayed sheet.
    drawDisplayed(page, vp, font, SHEETS[i].number, vp.width - 110, vp.height - 30, 18, rot);
    // Body text elsewhere on the sheet.
    drawDisplayed(page, vp, font, 'SEE A-103', 60, 80, 12, rot);
    // Sheet title just above the number, outside the region.
    drawDisplayed(page, vp, font, 'FLOOR PLAN', vp.width - 110, vp.height - 70, 10, rot);
  });
  return pdf.save();
}

test('a region drawn on one sheet finds the title-block number on cropped and rotated sheets', async () => {
  const { doc, task } = await open(await sheetsPdf());
  try {
    const first = modelViewport(await doc.getPage(1));
    assert.equal(first.width, 800);
    assert.equal(first.height, 700);
    // The user drags around the number on page 1 (model space).
    const fractions = regionFractions({ x: first.width - 130, y: first.height - 60, width: 125, height: 50 }, first.width, first.height);
    const texts = await extractRegionTexts(doc, fractions);
    assert.deepEqual(texts, ['A-101', 'A-102', 'A-103']);

    // The rotated sheets really are rotated: the viewport swaps width/height.
    const second = modelViewport(await doc.getPage(2));
    assert.deepEqual([second.width, second.height], [700, 800]);
  } finally {
    await task.destroy();
  }
});

test('the app rotation is part of the model space', async () => {
  const { doc, task } = await open(await sheetsPdf());
  try {
    const page = await doc.getPage(1);
    const items = (await page.getTextContent()).items;
    // Rotated 180 by the app, the number sits in the top-left corner.
    const vp = modelViewport(page, 180);
    assert.equal(textInRegion(items, vp, { x: 0, y: 0, width: 140, height: 60 }), 'A-101');
    assert.equal(textInRegion(items, modelViewport(page), { x: 0, y: 0, width: 140, height: 60 }), '');
  } finally {
    await task.destroy();
  }
});

test('character ranges of a run frame the word in model space', async () => {
  const { doc, task } = await open(await sheetsPdf());
  try {
    for (const p of [1, 2]) {
      const page = await doc.getPage(p);
      const vp = modelViewport(page);
      const item = (await page.getTextContent()).items.find(i => i.str === 'SEE A-103');
      const whole = textItemBox(item, vp);
      const ref = textItemBox(item, vp, 4, 9);
      // Starts near display (60, 80) and reads left to right.
      assert.ok(Math.abs(whole.x - 60) < 1.5, `page ${p}: x ${whole.x}`);
      assert.ok(whole.y < 80 && whole.y + whole.height > 80, `page ${p}: baseline inside`);
      assert.ok(ref.x > whole.x + 20 && Math.abs(ref.x + ref.width - (whole.x + whole.width)) < 0.01);
      assert.ok(Math.abs(ref.height - whole.height) < 0.01);
    }
  } finally {
    await task.destroy();
  }
});

test('regionOnPage scales the fractions to another page size', () => {
  const f = regionFractions({ x: 600, y: 600, width: 200, height: 100 }, 800, 700);
  const r = regionOnPage(f, 1600, 1400);
  assert.deepEqual(Object.values(r).map(v => Math.round(v * 1e6) / 1e6), [1200, 1200, 400, 200]);
  assert.equal(regionFractions({ x: 900, y: 0, width: 10, height: 10 }, 800, 700), null);
});

test('a measure function places the word by glyph widths instead of character count', async () => {
  const { doc, task } = await open(await sheetsPdf());
  try {
    const page = await doc.getPage(1);
    const vp = modelViewport(page);
    const item = (await page.getTextContent()).items.find(i => i.str === 'SEE A-103');
    const measure = (text) => [...text].reduce((w, c) => w + (c === ' ' ? 1 : 2), 0);
    const whole = textItemBox(item, vp);
    const ref = textItemBox(item, vp, 4, 9, measure);
    assert.ok(Math.abs(ref.x - (whole.x + whole.width * 7 / 17)) < 0.01);
    assert.ok(Math.abs(ref.x + ref.width - (whole.x + whole.width)) < 0.01);
  } finally {
    await task.destroy();
  }
});
