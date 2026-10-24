import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detailNodig, zichtbaarDeel, planUitsnede, dektZichtbaar, maakOperatieFilter, viewportSig, padIndex, bouwIndex, indexVoor, opsKloppen, uitsnedeInPdf,
  DETAIL_MAX_PIXELS, PDFJS_DETAIL_BASE_MAX_AXIS_PX, PdfJsDetailLayer,
} from './pdfjs-detail-layer.js';
import { pdfJsBitmapRatio } from './pdfjs-canvas-render.js';

// A 42" x 30" the external editor sheet (3024 x 2160 pt).
const BLAD = { w: 3024, h: 2160 };

test('the detail layer is needed exactly when the base bitmap is below the dpr', () => {
  for (const [zoom, dpr, nodig] of [[0.28, 1, false], [1, 1, false], [1, 2, true], [1.35, 1, false], [2, 1, true], [8, 2, true]]) {
    const k = pdfJsBitmapRatio(BLAD.w * zoom, BLAD.h * zoom, dpr, PDFJS_DETAIL_BASE_MAX_AXIS_PX);
    assert.equal(detailNodig(k, dpr), nodig, `zoom ${zoom} dpr ${dpr}`);
  }
});

test('visible part of the page, in page CSS px', () => {
  const pagina = { left: -5000, top: -3000, width: 24192, height: 17280 };
  const container = { left: 340, top: 100, right: 1564, bottom: 700 };
  assert.deepEqual(zichtbaarDeel(pagina, container), { minX: 5340, minY: 3100, maxX: 6564, maxY: 3700 });
  assert.equal(zichtbaarDeel({ left: 2000, top: 0, width: 100, height: 100 }, container), null, 'page out of view');
});

test('the detail area adds a margin, stays on the page and within the pixel budget', () => {
  const zicht = { minX: 5340, minY: 3100, maxX: 6564, maxY: 3700 };
  const a = planUitsnede(zicht, { width: 24192, height: 17280 }, 2);
  assert.ok(a.minX < zicht.minX && a.minY < zicht.minY, 'margin before');
  assert.ok(a.minX + a.width > zicht.maxX && a.minY + a.height > zicht.maxY, 'margin after');
  assert.ok(a.width * a.height * 4 <= DETAIL_MAX_PIXELS * 1.01, 'pixel budget at dpr 2');
  assert.ok(dektZichtbaar(a, zicht));
  // Against the page edge: no area outside the page.
  const rand = planUitsnede({ minX: 0, minY: 0, maxX: 800, maxY: 500 }, { width: 900, height: 600 }, 1);
  assert.deepEqual([rand.minX, rand.minY], [0, 0]);
  assert.ok(rand.minX + rand.width <= 900 && rand.minY + rand.height <= 600);
  // A huge window: the area is shrunk around its centre to the budget.
  const groot = planUitsnede({ minX: 0, minY: 0, maxX: 5000, maxY: 4000 }, { width: 50000, height: 40000 }, 2);
  assert.ok(groot.width * groot.height * 4 <= DETAIL_MAX_PIXELS * 1.01);
});

test('a scrolled view outside the drawn area asks for a new detail render', () => {
  const a = { minX: 100, minY: 100, width: 1000, height: 600 };
  assert.ok(dektZichtbaar(a, { minX: 300, minY: 200, maxX: 900, maxY: 600 }));
  assert.ok(!dektZichtbaar(a, { minX: 600, minY: 200, maxX: 1200, maxY: 600 }));
  assert.ok(!dektZichtbaar(null, { minX: 0, minY: 0, maxX: 1, maxY: 1 }));
});

test('path index: painted paths get a page-space box; state, clips, text and groups are always kept', () => {
  // pdf.js OPS codes: save 10, restore 11, transform 12, setLineWidth 2,
  // constructPath 91 (args [paintOp, data, minMax]), stroke 20, fill 22,
  // endPath 28, clip 29, showText 44, beginGroup 76, endGroup 77.
  const fn = [10, 12, 2, 91, 91, 11, 29, 91, 91, 44, 76, 91, 77, 91];
  const args = [
    [], [2, 0, 0, 2, 100, 0], [4], [20, null, [0, 0, 10, 10]], [22, null, [50, 50, 60, 60]], [],
    [], [22, null, [0, 0, 5, 5]], [22, null, [0, 0, 5, 5]], [[]], [{}], [22, null, [0, 0, 1, 1]], [], [20, null, [300, 300, 310, 310]],
  ];
  const { boxen } = padIndex(fn, args);
  const box = (i) => Array.from(boxen.slice(i * 4, i * 4 + 4));
  // Stroke under scale 2 + offset 100, line width 4 (half = 2 user units) and 0.5 pt slack.
  assert.deepEqual(box(3), [100 - 4 - 0.5, -4 - 0.5, 100 + 24 + 0.5, 24 + 0.5]);
  assert.deepEqual(box(4), [200 - 0.5, 100 - 0.5, 220 + 0.5, 120 + 0.5], 'fill: no line-width margin');
  for (const i of [0, 1, 2, 5, 6, 9, 10, 11, 12]) assert.ok(Number.isNaN(boxen[i * 4]), `op ${i} always runs`);
  assert.ok(Number.isNaN(boxen[7 * 4]), 're W f: the painted path that carries a clip always runs');
  assert.deepEqual(box(8), [-0.5, -0.5, 5.5, 5.5], 'the next path is filterable again');
  assert.deepEqual(box(13), [300 - 0.5 - 0.5, 300 - 1, 310 + 1, 310 + 1], 'after restore: identity CTM, line width 1');
  const f = maakOperatieFilter(boxen, { minX: 190, minY: 90, maxX: 230, maxY: 130 });
  assert.deepEqual(fn.map((_, i) => f(i)), [true, true, true, false, true, true, true, true, false, true, true, true, true, false]);
});

test('path index in chunks equals one pass, and is cached per page and key', async () => {
  const fn = [], args = [];
  for (let i = 0; i < 1000; i++) { fn.push(i % 50 === 0 ? 12 : 91); args.push(i % 50 === 0 ? [1, 0, 0, 1, 1, 1] : [20, null, [i, i, i + 1, i + 1]]); }
  const een = padIndex(fn, args).boxen;
  const page = {};
  const stuk = await bouwIndex(page, 'k', { fnArray: fn, argsArray: args, lastChunk: true }, { stuk: 37, pauze: async () => {} });
  assert.deepEqual(Array.from(stuk), Array.from(een));
  assert.equal(indexVoor(page, 'k'), stuk);
  assert.equal(indexVoor(page, 'anders'), null);
  assert.equal(await bouwIndex({}, 'k', { fnArray: fn, argsArray: args, lastChunk: false }), null, 'incomplete list: no index');
  assert.ok(opsKloppen({ save: 10, constructPath: 91, stroke: 20 }));
  assert.ok(!opsKloppen({ save: 10, constructPath: 92 }), 'other pdf.js op codes: no filter');
});

test('detail area to PDF space goes through the viewport (rotation and origin)', () => {
  // 90-degree viewport: PDF (x, y) -> CSS (y, x) at scale 1, as a stand-in.
  const vp = { convertToPdfPoint: (x, y) => [y - 1512, x - 1080] };
  assert.deepEqual(uitsnedeInPdf(vp, { minX: 10, minY: 20, width: 100, height: 50 }), { minX: -1492, minY: -1070, maxX: -1442, maxY: -970 });
});

test('viewport signature: same size/rotation/dpr = same, any change differs', () => {
  const v = { width: 6048, height: 4320, rotation: 0 };
  assert.equal(viewportSig(v, 2), viewportSig({ ...v }, 2));
  assert.notEqual(viewportSig(v, 2), viewportSig({ ...v, rotation: 90 }, 2));
  assert.notEqual(viewportSig(v, 2), viewportSig(v, 1));
  assert.notEqual(viewportSig(v, 2), viewportSig({ ...v, width: 6049 }, 2));
});

test('detail layer: renders the visible area at device resolution and positions it on the page', async () => {
  const oldDocument = globalThis.document;
  const gemaakt = [];
  globalThis.document = { createElement: () => {
    const c = { width: 0, height: 0, style: {}, dataset: {}, setAttribute() {},
      getContext: () => ({ fillRect() {}, drawImage() {}, setTransform() {} }) };
    gemaakt.push(c);
    return c;
  } };
  try {
    const renders = [];
    const page = { render: (p) => { renders.push(p); return { promise: Promise.resolve(), cancel() {} }; } };
    const zicht = { style: {}, dataset: {}, parentElement: null, width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
    const parent = { querySelector: () => zicht };
    zicht.parentElement = parent;
    const base = { parentElement: parent, offsetLeft: 0, offsetTop: 0, width: 4096, height: 2925,
      getBoundingClientRect: () => ({ left: -4000, top: -3000, width: 24192, height: 17280 }) };
    const container = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 600 }) };
    const laag = new PdfJsDetailLayer({ getBaseCanvas: () => base, getContainer: () => container });
    const viewport = { width: 24192, height: 17280, rotation: 0 };
    laag.zetPagina({ page, viewport, viewportVoor: (s) => ({ width: 3024 * s, height: 2160 * s, rotation: 0 }),
      dpr: 2, baseRatio: 4096 / 24192, sleutel: 'k' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const detail = renders.find((p) => p.transform);
    assert.ok(detail, 'a detail render with a transform');
    assert.equal(detail.transform[0], 2, 'device resolution');
    assert.equal(zicht.style.display, 'block');
    const left = parseFloat(zicht.style.left), top = parseFloat(zicht.style.top);
    assert.ok(left <= 4000 && left + parseFloat(zicht.style.width) >= 5200, 'covers the visible columns');
    assert.ok(top <= 3000 && top + parseFloat(zicht.style.height) >= 3600, 'covers the visible rows');
    assert.equal(zicht.width, Math.round(parseFloat(zicht.style.width) * 2));
    // Low zoom: base is sharp enough, the layer hides.
    laag.zetPagina({ page, viewport: { width: 1512, height: 1080, rotation: 0 }, viewportVoor: () => ({ width: 1, height: 1 }),
      dpr: 2, baseRatio: 2, sleutel: 'k' });
    assert.equal(zicht.style.display, 'none');
  } finally {
    globalThis.document = oldDocument;
  }
});

test('continuous view: a layer per page uses a class canvas in its page container and frees it out of view', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, dataset: {}, setAttribute() {},
    getContext: () => ({ fillRect() {}, drawImage() {} }) }) };
  try {
    let gemaakt = null;
    const parent = { querySelector: (sel) => { assert.equal(sel, ':scope > canvas.pdf-detail-canvas'); return gemaakt; } };
    let rect = { left: -2000, top: -1000, width: 12096, height: 8640 };
    const base = { parentElement: parent, isConnected: true, offsetLeft: 0, offsetTop: 0, style: { width: '12096px' },
      getBoundingClientRect: () => rect,
      insertAdjacentElement: (_w, el) => { gemaakt = el; } };
    const container = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 600 }) };
    const page = { render: () => ({ promise: Promise.resolve(), cancel() {} }) };
    const laag = new PdfJsDetailLayer({ getBaseCanvas: () => base, getContainer: () => container, canvasClass: 'pdf-detail-canvas' });
    laag.zetPagina({ page, viewport: { width: 12096, height: 8640, rotation: 0 }, viewportVoor: () => ({ width: 1, height: 1 }),
      dpr: 2, baseRatio: 4096 / 12096, sleutel: 'k' });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(gemaakt.className, 'pdf-detail-canvas');
    assert.equal(gemaakt.style.display, 'block');
    assert.ok(laag.inBeeld());
    rect = { left: 5000, top: 0, width: 12096, height: 8640 };
    assert.ok(!laag.inBeeld(), 'page scrolled out of view');
    laag.vrijgeven();
    assert.deepEqual([gemaakt.width, gemaakt.height, gemaakt.style.display], [0, 0, 'none']);
  } finally {
    globalThis.document = oldDocument;
  }
});
