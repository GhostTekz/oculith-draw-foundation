import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pdfiumMatrix, extraRotatie, pasToe } from './pdfium-matrix.js';
import { pdfiumWebToegestaan, pdfiumWebRasterizer, _zetModuleKapot } from './pdfium-web-rasterizer.js';

// A 3024 x 2160 pt sheet (42" x 30").
const W = 3024, H = 2160;

test('matrix without extra rotation: page points to bitmap pixels of a viewport region', () => {
  // 400 % on a dpr-2 screen, region starting at CSS (5000, 3000).
  const m = pdfiumMatrix({ W, H, rotatie: 0, schaal: 4, k: 2, minX: 5000, minY: 3000 });
  assert.deepEqual(pasToe(m, 1250, 750), [0, 0], 'region corner = bitmap origin');
  assert.deepEqual(pasToe(m, 1251, 750), [8, 0], 'one point = schaal x k pixels');
  // Whole page at the capped base ratio: the page fills the bitmap.
  const b = pdfiumMatrix({ W, H, schaal: 1.5, k: 4096 / (W * 1.5) });
  const [x, y] = pasToe(b, W, H);
  assert.ok(Math.abs(x - 4096) < 1e-6 && Math.abs(y - 4096 * H / W) < 1e-6);
});

test('matrix with an extra clockwise rotation keeps the page inside the rotated viewport (like PDF.js)', () => {
  for (const rot of [90, 180, 270]) {
    const m = pdfiumMatrix({ W, H, rotatie: rot, schaal: 1, k: 1 });
    const vw = rot === 180 ? W : H, vh = rot === 180 ? H : W;
    for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const [x, y] = pasToe(m, px, py);
      assert.ok(x >= -1e-9 && x <= vw + 1e-9 && y >= -1e-9 && y <= vh + 1e-9, `${rot}: (${px},${py}) -> (${x},${y})`);
    }
  }
  // 90 degrees clockwise: the top-left corner of the page goes to the top-right.
  assert.deepEqual(pasToe(pdfiumMatrix({ W, H, rotatie: 90, schaal: 1, k: 1 }), 0, 0), [H, 0]);
  assert.deepEqual(pasToe(pdfiumMatrix({ W, H, rotatie: 270, schaal: 1, k: 1 }), 0, 0), [0, W]);
  assert.equal(extraRotatie(90, 90), 0, '/Rotate is already in the PDFium page space');
  assert.equal(extraRotatie(0, 90), 270);
  assert.equal(extraRotatie(180, 0), 180);
});

test('PDFium draws in the browser only when it can match the file; otherwise PDF.js', () => {
  const ja = { inTauri: false, voorkeur: true, heeftBytes: true, ocgAfwijkend: false, moduleKapot: false, docKapot: false };
  assert.equal(pdfiumWebToegestaan(ja), true);
  assert.equal(pdfiumWebToegestaan({ ...ja, voorkeur: undefined }), true, 'default on');
  assert.equal(pdfiumWebToegestaan({ ...ja, inTauri: true }), false, 'desktop: native PDFium');
  assert.equal(pdfiumWebToegestaan({ ...ja, voorkeur: false }), false, 'preference off');
  assert.equal(pdfiumWebToegestaan({ ...ja, heeftBytes: false }), false, 'blank document without bytes');
  assert.equal(pdfiumWebToegestaan({ ...ja, ocgAfwijkend: true }), false, 'user layer choice: PDF.js knows it');
  assert.equal(pdfiumWebToegestaan({ ...ja, moduleKapot: true }), false, 'wasm failed to load');
  assert.equal(pdfiumWebToegestaan({ ...ja, docKapot: true }), false, 'PDFium could not open this file');
  const args = { bytes: new Uint8Array([1, 2, 3]), inTauri: false, voorkeur: true, ocgAfwijkend: false, toonNms: () => null };
  assert.ok(pdfiumWebRasterizer(args), 'a rasterizer object');
  assert.equal(pdfiumWebRasterizer({ ...args, bytes: null }), null);
  _zetModuleKapot(true);
  try {
    assert.equal(pdfiumWebRasterizer(args), null);
  } finally {
    _zetModuleKapot(false);
  }
});

test('the base render uses the rasterizer first and PDF.js only when it returns nothing', async () => {
  const { renderPdfJsPageToCanvas } = await import('../pdfjs-canvas-render.js');
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ setTransform() {}, fillRect() {} }) }) };
  try {
    let pdfjs = 0;
    const page = { render: () => { pdfjs++; return { promise: Promise.resolve() }; } };
    const getekend = [];
    const canvas = { width: 1, height: 1, style: {}, getContext: () => ({ drawImage: (c) => getekend.push(c) }) };
    const bron = { width: 400, height: 200, marker: 'pdfium' };
    let gevraagd = null;
    const rasterizer = { naam: 'pdfium', renderPagina: async (o) => { gevraagd = o; return bron; } };
    await renderPdfJsPageToCanvas({ page, viewport: { width: 200, height: 100 }, canvas, dpr: 2, rasterizer, renderParams: { annotationMode: 1 } });
    assert.equal(pdfjs, 0, 'PDF.js not used');
    assert.equal(getekend[0], bron);
    assert.deepEqual([gevraagd.k, gevraagd.breedte, gevraagd.hoogte, gevraagd.renderParams.annotationMode], [2, 400, 200, 1]);
    await renderPdfJsPageToCanvas({ page, viewport: { width: 200, height: 100 }, canvas, dpr: 2,
      rasterizer: { renderPagina: async () => null } });
    assert.equal(pdfjs, 1, 'fallback to PDF.js');
  } finally {
    globalThis.document = oldDocument;
  }
});

test('the detail layer asks the rasterizer for the visible area first, PDF.js only as fallback', async () => {
  const { PdfJsDetailLayer } = await import('../pdfjs-detail-layer.js');
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, dataset: {}, setAttribute() {},
    getContext: () => ({ fillRect() {}, drawImage() {}, setTransform() {} }) }) };
  try {
    let pdfjs = 0;
    const page = { render: () => { pdfjs++; return { promise: Promise.resolve(), cancel() {} }; } };
    const getekend = [];
    const zicht = { style: {}, dataset: {}, width: 0, height: 0, getContext: () => ({ drawImage: (c) => getekend.push(c) }) };
    const parent = { querySelector: () => zicht };
    zicht.parentElement = parent;
    const base = { parentElement: parent, offsetLeft: 0, offsetTop: 0, style: { width: '24192px' },
      getBoundingClientRect: () => ({ left: -4000, top: -3000, width: 24192, height: 17280 }) };
    const container = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 600 }) };
    const laag = new PdfJsDetailLayer({ getBaseCanvas: () => base, getContainer: () => container });
    const vanPdfium = { marker: 'pdfium' };
    let vraag = null;
    const rasterizer = { naam: 'pdfium', renderUitsnede: async (o) => { vraag = o; return vanPdfium; } };
    laag.zetPagina({ page, viewport: { width: 24192, height: 17280, rotation: 0 }, viewportVoor: () => ({}),
      dpr: 2, baseRatio: 4096 / 24192, sleutel: 'k', rasterizer, renderParams: { annotationMode: 1 } });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(pdfjs, 0, 'PDF.js not used');
    assert.equal(getekend[0], vanPdfium);
    assert.equal(zicht.dataset.engine, 'pdfium');
    assert.equal(vraag.dpr, 2);
    assert.equal(vraag.breedte, Math.round(vraag.uitsnede.width * 2));
    assert.equal(vraag.renderParams.annotationMode, 1, 'same markup rule as the base render');
  } finally {
    globalThis.document = oldDocument;
  }
});
