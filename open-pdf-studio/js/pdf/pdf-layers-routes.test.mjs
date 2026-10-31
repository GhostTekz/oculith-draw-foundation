// PDF layer toggles on real PDF bytes: a pdf-lib CAD-style sheet with an
// Architectural, an Electrical and a Text layer, on a plain page and on a
// /Rotate 90 page with a CropBox (pdf-layers.testhulp.mjs). Through the app's
// own selection API, hiding and soloing layers must change
//   - PDF.js page pixels (display, thumbnails and the offscreen render that
//     image export, raster PDF export and raster print share),
//   - PDFium worker pixels (when a built worker and the Linux runtime exist),
//   - the snap geometry (no points or edges on hidden layers),
// while an ordinary save keeps the PDF's own default layer configuration and
// "Save layer visibility as the PDF default" writes exactly the view.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register, createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName } from 'pdf-lib';

register('../core/app-test-hooks.mjs', import.meta.url);
register('./saver-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('./tekstvak-canvas.testhulp.mjs');
installeerCanvas();
globalThis.window.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);

let napi = null;
try {
  napi = createRequire(import.meta.url)('@napi-rs/canvas');
} catch {
  napi = null; // optional dependency of pdfjs-dist; without it the pixel cases skip
}

const { state } = await import('../core/state.js');
const selection = await import('./native-ocg-selection.js');
const { setLayerViewStorage, recallLayerView, layerViewKey } = await import('./layer-view-memory.js');
const { extractPageGeometry, clearPdfVectorCache } = await import('../tools/pdf-snap-extractor.js');
const { readNativeOcgDefault, writeNativeOcgDefault } = await import('./saver/native-ocg-default.js');
const { savePDF } = await import('./saver.js');
const { buildLayersFixture, pdfJsId, ARCH, ELEC, PAGE2_SHIFT } = await import('./pdf-layers.testhulp.mjs');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

// Applying a view re-renders the active document's page; the renderer needs a
// real window, so the selection changes here while the document is inactive
// (every cache is still invalidated) and becomes active again afterwards.
async function quiet(change) {
  const active = state.activeDocumentIndex;
  state.activeDocumentIndex = -1;
  try {
    return await change();
  } finally {
    state.activeDocumentIndex = active;
  }
}

const storage = new Map();
setLayerViewStorage({ getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) });

const GREY = [128, 128, 128];
const RED = [255, 0, 0];
const WHITE = [255, 255, 255];

async function openDoc(bytes, filePath = 'C:/plans/E-101.pdf') {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
  const pdfDoc = await task.promise;
  const model = { id: `layers-${Math.random()}`, filePath, fileName: 'E-101.pdf', pdfDoc, annotations: [],
    pageRotations: {}, currentPage: 1, viewMode: 'single', _annotationPagesReady: new Set([1, 2]),
    textEdits: [], selectedAnnotations: [] };
  state.documents = [model];
  state.activeDocumentIndex = 0;
  const doc = state.documents[0];
  // A remembered view is applied through the selection queue: let it settle.
  await quiet(async () => {
    await selection.initializeNativeOcgSelection(doc);
    await selection.setNativeOcgVisibilities(doc, {});
  });
  return { doc, destroy: () => task.destroy() };
}

/** Center of a block in PDF user space on page `pageNum`, as viewport pixels. */
async function viewportPoint(doc, pageNum, [x, y], scale = 1) {
  const page = await doc.pdfDoc.getPage(pageNum);
  const shift = pageNum === 2 ? PAGE2_SHIFT : [0, 0];
  const viewport = page.getViewport({ scale });
  return viewport.convertToViewportPoint(x + shift[0], y + shift[1]).map(Math.floor);
}
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

async function pdfjsPixels(doc, pageNum, points) {
  const page = await doc.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport, annotationMode: 0,
    optionalContentConfigPromise: selection.nativeOcgPdfJsConfig(doc) }).promise;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return points.map(([x, y]) => [...data.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3)]);
}

function close(actual, expected, tolerance = 12) {
  return actual.every((channel, i) => Math.abs(channel - expected[i]) <= tolerance);
}

function assertColors(actual, expected, label) {
  actual.forEach((pixel, i) => assert.ok(close(pixel, expected[i]), `${label} #${i}: ${pixel} ≠ ${expected[i]}`));
}

const ids = (refs) => ({ arch: pdfJsId(refs.arch), elec: pdfJsId(refs.elec), text: pdfJsId(refs.text) });

test('the Layers panel model lists the three drawing layers with their names and defaults', async () => {
  const { bytes, refs } = await buildLayersFixture();
  const { doc, destroy } = await openDoc(bytes);
  try {
    const states = selection.nativeOcgLayerStates(doc);
    assert.deepEqual(states.map(s => [s.id, s.name, s.visible, s.defaultVisible]), [
      [ids(refs).arch, 'Architectural', true, true],
      [ids(refs).elec, 'Electrical', true, true],
      [ids(refs).text, 'Text', true, true],
    ]);
    assert.equal(selection.nativeOcgSelectionDiffers(doc), false);
  } finally {
    await destroy();
  }
});

test('hide, show only and reset change PDF.js pixels on a plain and a rotated CropBox page', { skip: !napi }, async () => {
  const { bytes, refs } = await buildLayersFixture();
  const { doc, destroy } = await openDoc(bytes);
  const id = ids(refs);
  try {
    for (const pageNum of [1, 2]) {
      const points = [await viewportPoint(doc, pageNum, center(ARCH)), await viewportPoint(doc, pageNum, center(ELEC))];
      assertColors(await pdfjsPixels(doc, pageNum, points), [GREY, RED], `p${pageNum} default`);
    }
    const before = selection.nativeOcgSelectionForDocument(doc).revision;
    await quiet(() => selection.setNativeOcgVisibility(doc, id.arch, false));
    assert.equal(selection.nativeOcgSelectionForDocument(doc).revision, before + 1);
    assert.deepEqual(selection.nativeOcgSelectionForDocument(doc).ocgVisibility,
      [{ object_number: refs.arch.objectNumber, generation: 0, visible: false }]);
    for (const pageNum of [1, 2]) {
      const points = [await viewportPoint(doc, pageNum, center(ARCH)), await viewportPoint(doc, pageNum, center(ELEC))];
      assertColors(await pdfjsPixels(doc, pageNum, points), [WHITE, RED], `p${pageNum} architectural hidden`);
    }
    // The rotated page really is rotated: its viewport is the CropBox turned a quarter.
    const page2 = await doc.pdfDoc.getPage(2);
    const vp2 = page2.getViewport({ scale: 1 });
    assert.deepEqual([vp2.width, vp2.height, page2.rotate], [200, 220, 90]);

    await quiet(() => selection.soloNativeOcg(doc, id.arch));
    for (const pageNum of [1, 2]) {
      const points = [await viewportPoint(doc, pageNum, center(ARCH)), await viewportPoint(doc, pageNum, center(ELEC))];
      assertColors(await pdfjsPixels(doc, pageNum, points), [GREY, WHITE], `p${pageNum} architectural only`);
    }
    await quiet(() => selection.setAllNativeOcg(doc, false));
    await quiet(() => selection.setAllNativeOcg(doc, true));
    assert.equal(selection.nativeOcgSelectionDiffers(doc), false);
    await quiet(() => selection.setNativeOcgVisibilities(doc, { [id.elec]: false, [id.text]: false }));
    await quiet(() => selection.resetNativeOcgSelection(doc));
    assert.deepEqual(selection.nativeOcgSelectionForDocument(doc).ocgVisibility, []);
  } finally {
    await destroy();
  }
});

test('the offscreen render for image export, raster PDF export and raster print honours the view', { skip: !napi }, async () => {
  const { bytes, refs } = await buildLayersFixture();
  const { doc, destroy } = await openDoc(bytes);
  const createElement = globalThis.document.createElement;
  globalThis.document.createElement = (tag, ...rest) => (tag === 'canvas' ? napi.createCanvas(1, 1)
    : createElement.call(globalThis.document, tag, ...rest));
  try {
    const { renderPageOffscreen } = await import('./exporter.js');
    await quiet(() => selection.soloNativeOcg(doc, ids(refs).elec));
    for (const pageNum of [1, 2]) {
      const canvas = await renderPageOffscreen(pageNum, 1, { doc, markeringen: false });
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const px = ([x, y]) => [...data.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3)];
      const arch = px(await viewportPoint(doc, pageNum, center(ARCH)));
      const elec = px(await viewportPoint(doc, pageNum, center(ELEC)));
      // A transparent page background reads as 0,0,0,0: hidden means no grey ink.
      assert.ok(!close(arch, GREY), `p${pageNum} architectural must be hidden in export, got ${arch}`);
      assert.ok(close(elec, RED), `p${pageNum} electrical stays in export, got ${elec}`);
    }
  } finally {
    globalThis.document.createElement = createElement;
    await quiet(() => selection.resetNativeOcgSelection(doc));
    await destroy();
  }
});

test('snapping ignores the geometry of hidden layers, also on the rotated CropBox page', async () => {
  const { bytes, refs } = await buildLayersFixture();
  const { doc, destroy } = await openDoc(bytes);
  const id = ids(refs);
  const near = (edges, [x, y]) => edges.some(e => Math.min(Math.hypot(e.x1 - x, e.y1 - y), Math.hypot(e.x2 - x, e.y2 - y)) < 0.5);
  try {
    for (const pageNum of [1, 2]) {
      clearPdfVectorCache();
      const archEnd = await viewportPoint(doc, pageNum, ARCH.wall[1]);
      const elecEnd = await viewportPoint(doc, pageNum, ELEC.line[1]);
      const all = await extractPageGeometry(pageNum, { document: doc });
      assert.ok(near(all.edges, archEnd) && near(all.edges, elecEnd), `p${pageNum} both layers snap by default`);
      await quiet(() => selection.setNativeOcgVisibility(doc, id.arch, false));
      const filtered = await extractPageGeometry(pageNum, { document: doc });
      assert.ok(!near(filtered.edges, archEnd), `p${pageNum} hidden architectural wall is not a snap edge`);
      assert.ok(!filtered.points.some(p => Math.hypot(p.x - archEnd[0], p.y - archEnd[1]) < 0.5));
      assert.ok(near(filtered.edges, elecEnd), `p${pageNum} electrical circuit still snaps`);
      assert.ok(filtered.edges.length < all.edges.length);
      const everything = await extractPageGeometry(pageNum, { document: doc, allLayers: true });
      assert.equal(everything.edges.length, all.edges.length);
      await quiet(() => selection.resetNativeOcgSelection(doc));
    }
  } finally {
    await destroy();
  }
});

test('the view is remembered per document and comes back on reopen', async () => {
  const { bytes, refs } = await buildLayersFixture();
  const first = await openDoc(bytes, 'C:/plans/remember.pdf');
  await quiet(() => selection.soloNativeOcg(first.doc, ids(refs).elec));
  const key = layerViewKey('C:/plans/remember.pdf');
  assert.equal(recallLayerView(key, new Map([[ids(refs).arch, { name: 'Architectural', defaultVisible: true }]])).get(ids(refs).arch), false);
  await first.destroy();

  const again = await openDoc(bytes, 'C:/plans/remember.pdf');
  try {
    assert.deepEqual(selection.nativeOcgLayerStates(again.doc).map(s => s.visible), [false, true, false]);
    await quiet(() => selection.resetNativeOcgSelection(again.doc));
    assert.equal(recallLayerView(key, new Map([[ids(refs).arch, { name: 'Architectural', defaultVisible: true }]])).size, 0);
  } finally {
    await again.destroy();
  }
});

async function saveThrough(doc, bytes, opties = {}) {
  let saved;
  globalThis.__saverTest = { impl: {
    getCachedPdfBytes: () => bytes,
    writeBinaryFile: (_path, data) => { saved = data; return true; },
    writeBinaryFileAtomic: (_path, data) => { saved = data; return true; },
  } };
  assert.equal(await savePDF(doc.filePath, { zonderHandtekeningVraag: true, ...opties }, doc), true);
  assert.ok(saved, 'the saver wrote PDF bytes');
  return saved;
}

test('an ordinary save keeps the PDF default; "save as PDF default" writes exactly the view', async () => {
  const { bytes, refs } = await buildLayersFixture({ defaultOff: ['text'] });
  const { doc, destroy } = await openDoc(bytes, 'C:/plans/save.pdf');
  const key = (ref) => `${ref.objectNumber} ${ref.generationNumber}`;
  try {
    const source = readNativeOcgDefault(await PDFDocument.load(bytes));
    assert.deepEqual(Object.fromEntries(source), { [key(refs.arch)]: true, [key(refs.elec)]: true, [key(refs.text)]: false });
    await quiet(() => selection.setNativeOcgVisibilities(doc, { [ids(refs).arch]: false, [ids(refs).text]: true }));

    // Ordinary save with a changed view: the PDF's own configuration is untouched.
    const plain = await saveThrough(doc, bytes);
    const plainDoc = await PDFDocument.load(plain);
    assert.deepEqual(readNativeOcgDefault(plainDoc), source);
    const d = plainDoc.catalog.lookup(PDFName.of('OCProperties')).lookup(PDFName.of('D'));
    assert.equal(d.lookup(PDFName.of('Order')).size(), 3, 'the layer order survives the save');

    // Writing the view as default, in the same save path.
    const written = await saveThrough(doc, bytes, { nativeOcgDefault: selection.nativeOcgSelectionForDocument(doc).ocgVisibility });
    const writtenDoc = await PDFDocument.load(written);
    assert.deepEqual(Object.fromEntries(readNativeOcgDefault(writtenDoc)),
      { [key(refs.arch)]: false, [key(refs.elec)]: true, [key(refs.text)]: true });
    // PDF.js agrees after a reopen, and a second ordinary save keeps it.
    const reopenTask = pdfjs.getDocument({ data: written.slice(), isEvalSupported: false, verbosity: 0 });
    const config = await (await reopenTask.promise).getOptionalContentConfig();
    assert.deepEqual([...config].map(([, g]) => g.visible), [false, true, true]);
    await reopenTask.destroy();
    const second = await saveThrough(doc, written);
    assert.deepEqual(readNativeOcgDefault(await PDFDocument.load(second)), readNativeOcgDefault(writtenDoc));

    // The writer refuses what it cannot change safely.
    const locked = await PDFDocument.load(bytes);
    locked.catalog.lookup(PDFName.of('OCProperties')).lookup(PDFName.of('D'))
      .set(PDFName.of('Locked'), locked.context.obj([refs.arch]));
    assert.throws(() => writeNativeOcgDefault(locked, [{ object_number: refs.arch.objectNumber, generation: 0, visible: false }]), /locked/);
    assert.throws(() => writeNativeOcgDefault(locked, [{ object_number: 999, generation: 0, visible: false }]), /not part/);
  } finally {
    await quiet(() => selection.resetNativeOcgSelection(doc));
    await destroy();
  }
});

// PDFium: the same selection through the real worker protocol (render copy).
const here = dirname(fileURLToPath(import.meta.url));
const runtimeDir = resolve(here, '../../src-tauri/binaries/linux-x64');
const workerCandidates = [
  process.env.OCUDRAW_WORKER_BINARY,
  process.env.CARGO_TARGET_DIR && join(process.env.CARGO_TARGET_DIR, 'debug/pdfium-worker'),
  resolve(here, '../../../target/debug/pdfium-worker'),
].filter(Boolean);
const workerBinary = workerCandidates.find(path => existsSync(path));
const pdfiumAvailable = process.platform === 'linux' && !!workerBinary && existsSync(join(runtimeDir, 'libpdfium.so'));

test('PDFium worker pixels follow the same view on the plain and the rotated CropBox page', { skip: !pdfiumAvailable || !napi }, async () => {
  const { bytes, refs } = await buildLayersFixture();
  const work = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'pdf-layers-'));
  const pdfPath = join(work, 'layers.pdf');
  await writeFile(pdfPath, bytes);
  const { doc, destroy } = await openDoc(bytes, pdfPath);
  const namespace = `pdf-layers-${process.pid}`;
  const worker = spawn(workerBinary, ['0', namespace], { cwd: runtimeDir, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
  let requestId = 0;
  let ready;
  const render = async (pageIndex, ocgVisibility) => {
    const request = { op: 'render', id: ++requestId, path: pdfPath, page_index: pageIndex, scale: 1, rotation: 0 };
    if (ocgVisibility.length) request.ocg_visibility = ocgVisibility;
    worker.stdin.write(JSON.stringify(request) + '\n');
    const result = JSON.parse((await lines.next()).value);
    assert.equal(result.ok, true, JSON.stringify(result));
    const shm = await readFile(join(tmpdir(), ready.shm_name));
    const rgba = shm.subarray(32, 32 + result.shm_bytes);
    return { w: result.w, h: result.h, px: ([x, y]) => [...rgba.subarray((y * result.w + x) * 4, (y * result.w + x) * 4 + 3)] };
  };
  try {
    ready = JSON.parse((await lines.next()).value);
    assert.equal(ready.op, 'ready');
    assert.equal(ready.ocg_visibility, true);
    for (const [label, apply, expected] of [
      ['default', () => quiet(() => selection.resetNativeOcgSelection(doc)), [GREY, RED]],
      ['architectural hidden', () => quiet(() => selection.setNativeOcgVisibility(doc, ids(refs).arch, false)), [WHITE, RED]],
      ['electrical only', () => quiet(() => selection.soloNativeOcg(doc, ids(refs).elec)), [WHITE, RED]],
      ['architectural only', () => quiet(() => selection.soloNativeOcg(doc, ids(refs).arch)), [GREY, WHITE]],
    ]) {
      await apply();
      const view = selection.nativeOcgSelectionForDocument(doc).ocgVisibility;
      for (const pageNum of [1, 2]) {
        const image = await render(pageNum - 1, view);
        const points = [await viewportPoint(doc, pageNum, center(ARCH)), await viewportPoint(doc, pageNum, center(ELEC))];
        if (pageNum === 2) assert.deepEqual([image.w, image.h], [200, 220], 'PDFium shows the rotated CropBox');
        const pixels = points.map(image.px);
        // PDFium and PDF.js agree on the same pixels.
        assertColors(pixels, expected, `PDFium p${pageNum} ${label}`);
        assertColors(await pdfjsPixels(doc, pageNum, points), expected, `PDF.js p${pageNum} ${label}`);
      }
    }
    assert.deepEqual(await readFile(pdfPath), Buffer.from(bytes), 'rendering never changes the source file');
  } finally {
    worker.kill();
    await quiet(() => selection.resetNativeOcgSelection(doc));
    await destroy();
    await rm(join(tmpdir(), `pdfium-worker-${namespace}-0.shm`), { force: true });
    await rm(work, { recursive: true, force: true });
  }
});

// renderer.js (loaded by a layer change) starts a frame-jank interval when it
// loads; end the test process once every case has finished.
test.after(() => setImmediate(() => process.exit()));
