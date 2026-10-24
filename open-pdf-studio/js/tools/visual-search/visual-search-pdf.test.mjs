// Visual Search on real PDF bytes: a pdf-lib floor plan with 25 receptacles in
// four rotations among look-alikes, rendered by PDF.js (node canvas), searched
// through the session (in place: no Worker under node), turned into numbered
// count markers, saved and reopened. The second case puts the sheet on a
// /Rotate 90 page with a CropBox and checks every coordinate step against the
// user-space positions the symbols were drawn at.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register, createRequire } from 'node:module';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../../core/app-test-hooks.mjs', import.meta.url);
register('../../pdf/saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
// The browser stubs have a window without frames; PDF.js schedules render chunks on it.
globalThis.window.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);

let napi = null;
try {
  napi = createRequire(import.meta.url)('@napi-rs/canvas');
} catch {
  napi = null; // optional dependency of pdfjs-dist; without it the render cases skip
}
const createCanvas = (w, h) => napi.createCanvas(w, h);

const { state } = await import('../../core/state.js');
const { savePDF } = await import('../../pdf/saver.js');
const { convertPdfAnnotation } = await import('../../pdf/loader/annotation-converter.js');
const { extractAnnotationColors } = await import('../../pdf/loader/color-extraction.js');
const { decodePdfTextObject } = await import('../../pdf/saver/pdf-text.js');
const { puntNaarAppRuimte } = await import('../../pdf/pdf-viewports.js');
const { buildReceptacleFixture } = await import('./visual-search.testhulp.mjs');
const session = await import('./session.js');
const store = await import('../../solid/stores/visualSearchStore.js');
const { DEFAULT_THRESHOLD } = await import('./matcher.js');
const { usesWorker } = await import('./search-engine.js');

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function openDoc(bytes, id) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdfDoc = await task.promise;
  state.documents = [{ id, filePath: `C:/vs/${id}.pdf`, pdfDoc, annotations: [], pageRotations: {}, currentPage: 1,
    _annotationPagesReady: new Set([1]), textEdits: [], selectedAnnotations: [] }];
  state.activeDocumentIndex = 0;
  return { doc: state.documents[0], destroy: () => task.destroy() };
}

async function save(bytes) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF('C:/vs/output.pdf', { zonderHandtekeningVraag: true }), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

/** Saved count Squares: category, number and the /Rect centre in user space. */
async function rawCounts(bytes) {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const annots = ctx.lookup(doc.getPages()[0].node.get(PDFName.of('Annots')));
  return (annots ? annots.asArray() : []).map((ref) => ctx.lookup(ref)).filter((d) =>
    decodePdfTextObject(d.get(PDFName.of('OPS_Subtype'))) === 'count').map((d) => {
    const r = d.get(PDFName.of('Rect')).asArray().map((n) => n.asNumber());
    return {
      category: decodePdfTextObject(d.get(PDFName.of('OPS_CountCategory'))),
      number: d.get(PDFName.of('OPS_CountNumber'))?.asNumber(),
      x: (r[0] + r[2]) / 2,
      y: (r[1] + r[3]) / 2,
    };
  });
}

async function reopenCounts(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const pdfLibDoc = await PDFDocument.load(bytes.slice());
    const colors = await extractAnnotationColors(1, pdfLibDoc);
    const out = [];
    for (const a of await page.getAnnotations()) {
      const m = await convertPdfAnnotation(a, 1, page.getViewport({ scale: 1 }), new Map(), colors);
      if (m?.type === 'count') out.push(m);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/** Matches against expected app-space centres: true and false positives. */
function tally(results, expected, tol = 1.5) {
  const used = new Set();
  let tp = 0;
  for (const r of results) {
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const j = expected.findIndex((e, i) => !used.has(i) && Math.hypot(e[0] - cx, e[1] - cy) < tol);
    if (j >= 0) { used.add(j); tp++; }
  }
  return { tp, fp: results.length - tp };
}

/** Pick, search, create counts, save; returns what each step produced. */
async function searchAndCount({ rotate = 0, cropBox, viewBox }) {
  const fx = await buildReceptacleFixture({ rotate, cropBox });
  const { doc, destroy } = await openDoc(fx.bytes, `rot${rotate}`);
  try {
    const expected = fx.symbols.map((s) => puntNaarAppRuimte(s.cx, s.cy, viewBox, rotate));
    // The user drags a 24 pt square around the first receptacle.
    const [px, py] = expected[0];
    const t = await session.buildTemplate(doc, 1, { x: px - 12, y: py - 12, width: 24, height: 24 }, createCanvas);
    assert.ok(t, 'the pick has a template');
    store.setTemplate(t);
    store.setThreshold(DEFAULT_THRESHOLD);
    const results = await session.runSearch({ pages: [1], createCanvas });
    assert.equal(store.status(), 'done');
    const chosen = store.chosenResults();
    const counts = await session.createCountMarkups('stopcontacten');
    const bytes = await save(fx.bytes);
    return { fx, expected, results, chosen, counts, bytes };
  } finally {
    await destroy();
  }
}

test('25 receptacles in four rotations: ≥ 24 found at the default threshold, ≤ 1 false positive; counts save and reopen',
  { skip: !napi && 'no @napi-rs/canvas' }, async () => {
    assert.equal(usesWorker(), false, 'node runs the search in place');
    const { fx, expected, results, chosen, counts, bytes } = await searchAndCount({ viewBox: [0, 0, 792, 612] });
    assert.ok(results.length >= chosen.length);
    const { tp, fp } = tally(chosen, expected);
    assert.ok(tp >= 24, `found ${tp} of 25`);
    assert.ok(fp <= 1, `${fp} false positives`);
    assert.ok(chosen.every((r) => [0, 90, 180, 270].includes(r.rotation)));
    assert.deepEqual(new Set(chosen.map((r) => r.rotation)), new Set([0, 90, 180, 270]));

    // Numbered counts in the chosen category, in reading order.
    assert.equal(counts.length, chosen.length);
    assert.deepEqual(counts.map((c) => c.number), counts.map((_, i) => i + 1));
    assert.ok(counts.every((c) => c.type === 'count' && c.categoryId === 'stopcontacten' && c.page === 1));
    for (let i = 1; i < counts.length; i++) {
      const [a, b] = [counts[i - 1], counts[i]];
      assert.ok(b.y > a.y - 8, 'numbers run top to bottom');
      if (Math.abs(b.y - a.y) < 10) assert.ok(b.x > a.x, 'and left to right within a row');
    }
    assert.equal(store.results().length, 0, 'the results are cleared once they became counts');

    // Saved: one count Square per marker, centred on the symbol in user space.
    const raw = await rawCounts(bytes);
    assert.equal(raw.length, counts.length);
    let onSymbol = 0;
    for (const r of raw) {
      if (fx.symbols.some((s) => Math.hypot(s.cx - r.x, s.cy - r.y) < 1.5)) onSymbol++;
    }
    assert.ok(onSymbol >= 24, `${onSymbol} saved counts sit on a receptacle`);
    assert.deepEqual(raw.map((r) => r.number).sort((a, b) => a - b), counts.map((c) => c.number));
    assert.ok(raw.every((r) => r.category === 'stopcontacten'));

    // Reopened: same numbers, category and positions.
    const back = await reopenCounts(bytes);
    assert.equal(back.length, counts.length);
    for (const c of counts) {
      const b = back.find((x) => x.number === c.number);
      assert.ok(b, `count ${c.number} reopened`);
      assert.equal(b.categoryId, 'stopcontacten');
      assert.ok(Math.abs(b.x - c.x) < 0.01 && Math.abs(b.y - c.y) < 0.01);
    }
  });

test('a /Rotate 90 page with a CropBox: results, counts and saved /Rect land on the drawn symbols',
  { skip: !napi && 'no @napi-rs/canvas' }, async () => {
    const cropBox = [20, 10, 760, 590]; // x, y, width, height
    const viewBox = [20, 10, 780, 600];
    const { fx, expected, chosen, counts, bytes } = await searchAndCount({ rotate: 90, cropBox, viewBox });
    const { tp, fp } = tally(chosen, expected, 1);
    assert.ok(tp >= 24, `found ${tp} of 25 within 1 pt of the expected app position`);
    assert.ok(fp <= 1, `${fp} false positives`);
    // App space of a quarter-turned page is the CropBox height wide.
    assert.ok(chosen.every((r) => r.x >= 0 && r.x + r.width <= 590 + 1 && r.y >= 0 && r.y + r.height <= 760 + 1));
    const raw = await rawCounts(bytes);
    assert.equal(raw.length, counts.length);
    let onSymbol = 0;
    for (const r of raw) {
      if (fx.symbols.some((s) => Math.hypot(s.cx - r.x, s.cy - r.y) < 1.5)) onSymbol++;
    }
    assert.ok(onSymbol >= 24, `${onSymbol} saved counts sit on a receptacle in user space`);
  });

test('Highlight turns the chosen results into rectangle highlights over the symbols',
  { skip: !napi && 'no @napi-rs/canvas' }, async () => {
    const fx = await buildReceptacleFixture();
    const { doc, destroy } = await openDoc(fx.bytes, 'hl');
    try {
      const [px, py] = puntNaarAppRuimte(fx.symbols[0].x, fx.symbols[0].y, [0, 0, 792, 612], 0);
      store.setTemplate(await session.buildTemplate(doc, 1, { x: px - 12, y: py - 12, width: 24, height: 24 }, createCanvas));
      await session.runSearch({ pages: [1], createCanvas });
      // Exclude one result by hand: it does not become a markup.
      const first = store.chosenResults()[0];
      store.setResultIncluded(first.id, false);
      const n = store.chosenResults().length;
      const anns = await session.highlightResults('#ffff00');
      assert.equal(anns.length, n);
      assert.equal(doc.annotations.length, n);
      assert.ok(anns.every((a) => a.type === 'highlight' && a.width > 10 && a.height > 10));
      assert.ok(!anns.some((a) => Math.abs(a.x - first.x) < 0.01 && Math.abs(a.y - first.y) < 0.01));
    } finally {
      await destroy();
    }
  });

test('raster matches map to page points; reading order groups uneven rows', async () => {
  const { matchToResult, inReadingOrder } = await import('./results.js');
  const r = matchToResult({ x: 30, y: 60, width: 15, height: 21, score: 0.95, rotation: 90, scale: 1 }, 2, 1.5);
  assert.deepEqual(r, { page: 2, x: 20, y: 40, width: 10, height: 14, score: 0.95, rotation: 90, scale: 1 });
  const at = (page, x, y) => ({ page, x, y, width: 10, height: 16 });
  const order = inReadingOrder([at(1, 300, 108), at(2, 0, 0), at(1, 100, 100), at(1, 200, 92), at(1, 50, 200)]);
  assert.deepEqual(order.map((o) => [o.page, o.x]), [[1, 100], [1, 200], [1, 300], [1, 50], [2, 0]]);
});

test('a pick on blank paper gives no template', { skip: !napi && 'no @napi-rs/canvas' }, async () => {
  const fx = await buildReceptacleFixture();
  const { doc, destroy } = await openDoc(fx.bytes, 'blank');
  try {
    assert.equal(await session.buildTemplate(doc, 1, { x: 300, y: 2, width: 20, height: 20 }, createCanvas), null);
  } finally {
    await destroy();
  }
});
