import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPdfJsPageToCanvas } from './pdfjs-canvas-render.js';

test('a superseded PDF.js render cannot resize or paint the visible canvas', async () => {
  const oldDocument = globalThis.document;
  const paints = [];
  globalThis.document = { createElement: () => ({
    getContext: () => ({ setTransform() {}, fillRect() {} }),
  }) };
  let finish;
  let current = true;
  const page = { render: () => ({ promise: new Promise(resolve => { finish = resolve; }) }) };
  const canvas = { width: 17, height: 19, style: { width: '17px', height: '19px' },
    getContext: () => ({ drawImage: (...args) => paints.push(args) }) };
  try {
    const pending = renderPdfJsPageToCanvas({ page, viewport: { width: 200, height: 100 },
      canvas, dpr: 2, isCurrent: () => current });
    current = false;
    finish();
    assert.equal(await pending, false);
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height],
      [17, 19, '17px', '19px']);
    assert.equal(paints.length, 0);

    current = true;
    const fresh = renderPdfJsPageToCanvas({ page: { render: () => ({ promise: Promise.resolve() }) },
      viewport: { width: 200, height: 100 }, canvas, dpr: 2, isCurrent: () => current });
    assert.equal(await fresh, true);
    assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height],
      [400, 200, '200px', '100px']);
    assert.equal(paints.length, 1);
  } finally {
    globalThis.document = oldDocument;
  }
});

test('deep zoom: the PDF.js bitmap is capped at 6144 px and CSS-stretched', async () => {
  const { pdfJsBitmapRatio, PDFJS_MAX_BITMAP_AXIS_PX } = await import('./pdfjs-canvas-render.js');
  assert.equal(pdfJsBitmapRatio(800, 600, 2), 2, 'normal zoom: the dpr');
  // A 24" x 16" sheet (1728 x 1152 pt) at 500 %: 8640 CSS px wide.
  assert.equal(pdfJsBitmapRatio(2538, 1785, 2), 2, 'a large sheet at 150 % on HiDPI stays sharp');
  const k = pdfJsBitmapRatio(8640, 5760, 2);
  assert.equal(Math.round(8640 * k), PDFJS_MAX_BITMAP_AXIS_PX);
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ setTransform() {}, fillRect() {} }) }) };
  try {
    const canvas = { width: 1, height: 1, style: {}, getContext: () => ({ drawImage() {} }) };
    await renderPdfJsPageToCanvas({ page: { render: () => ({ promise: Promise.resolve() }) },
      viewport: { width: 8640, height: 5760 }, canvas, dpr: 2 });
    assert.equal(canvas.width, PDFJS_MAX_BITMAP_AXIS_PX);
    assert.equal(canvas.style.width, '8640px', 'shown at the requested size');
  } finally {
    globalThis.document = oldDocument;
  }
});

test('same page and render key past the cap: CSS resize only, no new PDF.js render', async () => {
  const oldDocument = globalThis.document;
  const opties = [];
  globalThis.document = { createElement: () => ({ getContext: (_t, o) => { opties.push(o); return { setTransform() {}, fillRect() {} }; } }) };
  try {
    let renders = 0;
    const page = { render: () => { renders++; return { promise: Promise.resolve() }; } };
    const canvas = { width: 1, height: 1, style: {}, getContext: () => ({ drawImage() {} }) };
    // 3024 pt sheet at 200 % and 400 %: both hit the 4096 px cap, same bitmap.
    await renderPdfJsPageToCanvas({ page, viewport: { width: 6048, height: 4320 }, canvas, dpr: 2, maxAxisPx: 4096, renderKey: 'p1|0' });
    assert.equal(renders, 1);
    assert.deepEqual(opties[0], { willReadFrequently: true }, 'PDF.js rasterises into a CPU canvas');
    const ok = await renderPdfJsPageToCanvas({ page, viewport: { width: 12096, height: 8640 }, canvas, dpr: 2, maxAxisPx: 4096, renderKey: 'p1|0' });
    assert.equal(ok, true);
    assert.equal(renders, 1, 'reused');
    assert.equal(canvas.style.width, '12096px');
    await renderPdfJsPageToCanvas({ page, viewport: { width: 12096, height: 8640 }, canvas, dpr: 2, maxAxisPx: 4096, renderKey: 'p1|90' });
    assert.equal(renders, 2, 'another key renders again');
    await renderPdfJsPageToCanvas({ page: { render: () => { renders++; return { promise: Promise.resolve() }; } }, viewport: { width: 12096, height: 8640 }, canvas, dpr: 2, maxAxisPx: 4096, renderKey: 'p1|90' });
    assert.equal(renders, 3, 'another page object (reloaded document) renders again');
  } finally {
    globalThis.document = oldDocument;
  }
});
