// Selected native layers through the real Linux worker and live browser caches.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';

async function imagePixel(bytes, x, y) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)];
}

async function printImageBytes(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.getPage(0);
  const xObjects = page.node.Resources().lookup(PDFName.of('XObject'));
  for (const key of xObjects.keys()) {
    const stream = xObjects.lookup(key);
    if (stream instanceof PDFRawStream && stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Image') {
      return stream.contents;
    }
  }
  throw new Error('Raster PDF has no embedded page image');
}

function ocgFixture() {
  const content = '/OC /Visible BDC\n1 0 0 rg 10 10 30 30 re f\nEMC\n' +
    '/OC /Hidden BDC\n0 0 1 rg 60 10 30 30 re f\nEMC\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /BaseState /ON /OFF [6 0 R] /Order [5 0 R 6 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Properties << /Visible 5 0 R /Hidden 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /OCG /Name (Visible red) >>',
    '<< /Type /OCG /Name (Hidden blue) >>',
  ];
  let text = '%PDF-1.5\n';
  const offsets = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

async function nativePixels(workerBinary, pdfPath) {
  const namespace = `ocg-selection-${process.pid}`;
  const worker = spawn(workerBinary, ['0', namespace], {
    cwd: resolve('src-tauri/binaries/linux-x64'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
  try {
    const ready = JSON.parse((await lines.next()).value);
    assert.equal(ready.op, 'ready');
    const wires = [];
    let id = 0;
    for (const visible of [null, true, false]) {
      const pair = {};
      for (const op of ['render', 'render_region']) {
        const request = { op, id: ++id, path: pdfPath, page_index: 0, scale: 1, rotation: 0 };
        if (visible !== null) request.ocg_visibility = [{ object_number: 6, generation: 0, visible }];
        if (op === 'render_region') Object.assign(request, {
          region_x_pt: 50, region_y_pt: 50, region_w_pt: 50, region_h_pt: 50,
        });
        worker.stdin.write(JSON.stringify(request) + '\n');
        const result = JSON.parse((await lines.next()).value);
        assert.equal(result.ok, true, JSON.stringify(result));
        const shm = await readFile(join(tmpdir(), ready.shm_name));
        const rgba = shm.subarray(32, 32 + result.shm_bytes);
        const wire = Buffer.alloc(8 + rgba.length);
        wire.writeUInt32LE(result.w, 0);
        wire.writeUInt32LE(result.h, 4);
        rgba.copy(wire, 8);
        const px = (x, y) => [...rgba.subarray((y * result.w + x) * 4, (y * result.w + x) * 4 + 3)];
        assert.deepEqual(px(op === 'render' ? 75 : 25, op === 'render' ? 75 : 25),
          visible === true ? [0, 0, 255] : [255, 255, 255]);
        if (op === 'render') assert.deepEqual(px(25, 75), [255, 0, 0]);
        pair[op] = wire;
      }
      wires.push(pair);
    }
    return wires;
  } finally {
    worker.kill();
    await rm(join(tmpdir(), `pdfium-worker-${namespace}-0.shm`), { force: true });
  }
}

const work = await mkdtemp(join(tmpdir(), 'ocudraw-ocg-selection-'));
const source = ocgFixture();
const pdfPath = join(work, 'layers.pdf');
await writeFile(pdfPath, source);
const debugWorker = resolve('../target/debug/pdfium-worker');
const workerBinary = resolve(process.env.OCUDRAW_WORKER_BINARY
  || (existsSync(debugWorker) ? debugWorker : '../target/release/pdfium-worker'));
let server;
let browser;
try {
  const wires = await nativePixels(workerBinary, pdfPath);
  assert.deepEqual(await readFile(pdfPath), source, 'render copy changed source bytes');
  const probe = createNetServer();
  await new Promise((resolveListen, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = probe.address().port;
  await new Promise(resolveClose => probe.close(resolveClose));
  server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false }, logLevel: 'error' });
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
  await page.evaluate(async bytes => {
    const { createTab } = await import('/js/ui/chrome/tabs.js');
    const { loadPDF } = await import('/js/pdf/loader.js');
    const { index } = createTab('layers.pdf');
    await loadPDF('layers.pdf', index, Uint8Array.from(bytes));
    const { index: otherIndex } = createTab('other-layers.pdf', false);
    await loadPDF('other-layers.pdf', otherIndex, Uint8Array.from(bytes));
  }, Array.from(source));
  await page.locator('#pdf-container.visible').waitFor();
  assert.deepEqual(await page.evaluate(async () => {
    const { parseNativeOcgRef } = await import('/js/pdf/native-ocg-selection.js');
    return ['6R', '12R3', '0R', '6R65536', '6R-1', '6R0junk'].map(parseNativeOcgRef);
  }), [
    { objectNumber: 6, generation: 0 }, { objectNumber: 12, generation: 3 },
    null, null, null, null,
  ]);
  assert.deepEqual(await page.evaluate(async () => {
    const { initializeNativeOcgSelection } = await import('/js/pdf/native-ocg-selection.js');
    let resolveOld;
    const oldPdf = { getOptionalContentConfig: () => new Promise(resolve => { resolveOld = resolve; }) };
    const newPdf = { getOptionalContentConfig: async () => [['8R', { visible: true }]] };
    const doc = { pdfDoc: oldPdf };
    const stale = initializeNativeOcgSelection(doc);
    doc.pdfDoc = newPdf;
    const fresh = await initializeNativeOcgSelection(doc);
    resolveOld([['6R', { visible: false }]]);
    return { stale: await stale, groups: [...fresh.groups.keys()] };
  }), { stale: null, groups: ['8R'] }, 'late config from replaced PDF entered selection');
  await page.evaluate(async nativeWires => {
    const variants = nativeWires.map(pair => ({
      full: Uint8Array.from(pair.render), region: Uint8Array.from(pair.render_region),
    }));
    const canvasFor = bytes => {
      const view = new DataView(bytes.buffer);
      const width = view.getUint32(0, true), height = view.getUint32(4, true);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer, 8), width, height), 0, 0);
      return canvas;
    };
    window.__nativeCalls = [];
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      window.__nativeCalls.push({ command, args });
      const choice = args?.ocgVisibility?.find(item => item.object_number === 6);
      const variant = variants[choice ? (choice.visible ? 1 : 2) : 0];
      if (command === 'analyze_page_type') return 'vector';
      if (command === 'extract_draw_commands') throw 'OCG content requires PDFium renderer';
      if (command === 'render_pdf_page') {
        if (choice?.visible && window.__holdSelectedPage) {
          return new Promise(resolve => { (window.__heldSelectedPages ||= []).push(() => resolve(variant.full)); });
        }
        return variant.full;
      }
      if (command === 'render_pdf_page_region') {
        if (window.__holdCaptureRegion && args.regionWPt === 100 && args.regionHPt === 100) {
          return new Promise(resolve => { (window.__heldCaptureRegions ||= []).push(() => resolve(variant.region)); });
        }
        return variant.region;
      }
      if (command === 'render_thumbnail') {
        const canvas = canvasFor(variant.full);
        return JSON.stringify({ dataURL: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
      }
      if (command === 'page_content_size') return 0;
      throw new Error(`Unexpected native invoke: ${command}`);
    } } };
    window.__aecVectorPath = true;
    const { state } = await import('/js/core/state.ts');
    state.renderEngineOverride = null;
    const { clearAllBitmaps } = await import('/js/pdf/page-bitmap-cache.js');
    clearAllBitmaps();
    const { renderPage } = await import('/js/pdf/renderer.js');
    await renderPage(1);
  }, wires.map(pair => ({ render: Array.from(pair.render), render_region: Array.from(pair.render_region) })));
  await page.waitForFunction(() => window.__pdfViewport?.pageType === 'raster' && !!window.__pdfViewport.currentBitmap);
  const result = await page.evaluate(async () => {
    const bitmap = window.__pdfViewport.currentBitmap;
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    const { invalidateThumbnail } = await import('/js/ui/panels/left-panel.js');
    invalidateThumbnail(1);
    return { red: pixel(25, 75), hidden: pixel(75, 75), calls: window.__nativeCalls.map(call => call.command) };
  });
  assert.deepEqual(result.red, [255, 0, 0]);
  assert.deepEqual(result.hidden, [255, 255, 255]);
  assert.ok(result.calls.includes('extract_draw_commands'));
  assert.ok(result.calls.includes('render_pdf_page'));
  await page.waitForFunction(() => window.__nativeCalls.some(call => call.command === 'render_thumbnail'));
  const thumb = page.locator('.thumbnail-item[data-page="1"] img');
  await thumb.waitFor({ state: 'attached' });
  const thumbPixels = await thumb.evaluate(async image => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    return { red: pixel(Math.round(canvas.width * 0.25), Math.round(canvas.height * 0.75)),
      hidden: pixel(Math.round(canvas.width * 0.75), Math.round(canvas.height * 0.75)) };
  });
  assert.deepEqual(thumbPixels.red, [255, 0, 0]);
  assert.deepEqual(thumbPixels.hidden, [255, 255, 255]);
  for (const [visible, expectedBlue] of [[true, [0, 0, 255]], [false, [255, 255, 255]]]) {
    const selection = await page.evaluate(async selected => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const { setNativeOcgVisibility, nativeOcgSelectionForDocument } = await import('/js/pdf/native-ocg-selection.js');
      const doc = getActiveDocument();
      await setNativeOcgVisibility(doc, '6R', selected);
      return nativeOcgSelectionForDocument(doc);
    }, visible);
    assert.deepEqual(selection.ocgVisibility, visible ? [{ object_number: 6, generation: 0, visible: true }] : []);
    await page.waitForFunction(blue => {
      const bitmap = window.__pdfViewport?.currentBitmap;
      if (!bitmap) return false;
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      const pixel = [...ctx.getImageData(75, 75, 1, 1).data].slice(0, 3);
      return pixel.every((channel, i) => channel === blue[i]);
    }, expectedBlue);
    if (visible) {
      await page.evaluate(() => import('/js/ui/chrome/tabs.js').then(m => m.switchToTab(1)));
      await page.waitForFunction(() => {
        const vp = window.__pdfViewport;
        if (vp?.filePath !== 'other-layers.pdf' || !vp.currentBitmap) return false;
        const canvas = document.createElement('canvas'); canvas.width = vp.currentBitmap.width; canvas.height = vp.currentBitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(vp.currentBitmap, 0, 0);
        return [...ctx.getImageData(75, 75, 1, 1).data].slice(0, 3).every(v => v === 255);
      });
      assert.deepEqual(await page.evaluate(async () => {
        const { getActiveDocument } = await import('/js/core/state.ts');
        const { nativeOcgSelectionForDocument } = await import('/js/pdf/native-ocg-selection.js');
        return nativeOcgSelectionForDocument(getActiveDocument()).ocgVisibility;
      }), []);
      await page.evaluate(() => import('/js/ui/chrome/tabs.js').then(m => m.switchToTab(0)));
      await page.waitForFunction(() => {
        const vp = window.__pdfViewport;
        if (vp?.filePath !== 'layers.pdf' || !vp.currentBitmap) return false;
        const canvas = document.createElement('canvas'); canvas.width = vp.currentBitmap.width; canvas.height = vp.currentBitmap.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(vp.currentBitmap, 0, 0);
        return [...ctx.getImageData(75, 75, 1, 1).data].slice(0, 3).every((v, i) => v === [0, 0, 255][i]);
      });
    }
    const region = await page.evaluate(async () => {
      const { invokeTileRegion } = await import('/js/pdf/progressive-render.js');
      const bytes = await invokeTileRegion({ path: 'layers.pdf', pageIndex: 0, scale: 1, rotation: 0,
        regionXPt: 50, regionYPt: 50, regionWPt: 50, regionHPt: 50 });
      const wire = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const width = new DataView(wire.buffer).getUint32(0, true);
      const at = 8 + (25 * width + 25) * 4;
      return { pixel: Array.from(wire.subarray(at, at + 3)), call: window.__nativeCalls.at(-1) };
    });
    assert.deepEqual(region.pixel, expectedBlue);
    assert.equal(region.call.command, 'render_pdf_page_region');
    assert.deepEqual(region.call.args.ocgVisibility, selection.ocgVisibility);
    await page.waitForFunction(blue => {
      const image = document.querySelector('.thumbnail-item[data-page="1"] img');
      if (!image?.complete || !image.naturalWidth) return false;
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const pixel = [...ctx.getImageData(Math.round(canvas.width * 0.75), Math.round(canvas.height * 0.75), 1, 1).data].slice(0, 3);
      return pixel.every((channel, i) => channel === blue[i]);
    }, expectedBlue);
    assert.ok(await page.evaluate(expected => window.__nativeCalls.some(call =>
      call.command === 'render_thumbnail'
      && JSON.stringify(call.args.ocgVisibility) === JSON.stringify(expected)
    ), selection.ocgVisibility), 'thumbnail command omitted selected OCG state');
    assert.deepEqual(await page.evaluate(async () => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const { renderLowResPreview } = await import('/js/pdf/renderer.js');
      const canvas = await renderLowResPreview(getActiveDocument().pdfDoc, 1, 0, 0);
      return [...canvas.getContext('2d').getImageData(37, 37, 1, 1).data].slice(0, 3);
    }), expectedBlue, 'continuous low-res preview ignored selected OCG');
  }
  await page.evaluate(async () => {
    window.__holdSelectedPage = true;
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setNativeOcgVisibility } = await import('/js/pdf/native-ocg-selection.js');
    await setNativeOcgVisibility(getActiveDocument(), '6R', true);
  });
  await page.waitForFunction(() => (window.__heldSelectedPages?.length || 0) > 0);
  await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setNativeOcgVisibility } = await import('/js/pdf/native-ocg-selection.js');
    await setNativeOcgVisibility(getActiveDocument(), '6R', false);
    window.__holdSelectedPage = false;
    for (const release of window.__heldSelectedPages.splice(0)) release();
  });
  await page.waitForFunction(() => {
    const vp = window.__pdfViewport;
    if (!vp?.currentBitmap) return false;
    const canvas = document.createElement('canvas'); canvas.width = vp.currentBitmap.width; canvas.height = vp.currentBitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(vp.currentBitmap, 0, 0);
    return [...ctx.getImageData(75, 75, 1, 1).data].slice(0, 3).every(v => v === 255);
  });
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => {
    const vp = window.__pdfViewport;
    const canvas = document.createElement('canvas'); canvas.width = vp.currentBitmap.width; canvas.height = vp.currentBitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(vp.currentBitmap, 0, 0);
    return [...ctx.getImageData(75, 75, 1, 1).data].slice(0, 3);
  }), [255, 255, 255], 'late ON render repainted OFF state');
  assert.deepEqual(await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setNativeOcgVisibility, nativeOcgSelectionForDocument } = await import('/js/pdf/native-ocg-selection.js');
    const doc = getActiveDocument();
    const on = setNativeOcgVisibility(doc, '6R', true);
    const off = setNativeOcgVisibility(doc, '6R', false);
    await Promise.all([on, off]);
    return nativeOcgSelectionForDocument(doc).ocgVisibility;
  }), [], 'concurrent ON→OFF setter lost the last request');
  assert.equal(await page.evaluate(async () => {
    const { _bitmapJSCacheSet, _bitmapJSCacheGet, clearBitmapJSCacheForFile } = await import('/js/pdf/renderer.js');
    const path = '/tmp/a|b.pdf';
    const key = `${path}|1|10000|0|0`;
    const marker = { width: 1, height: 1 };
    const original = window.createImageBitmap;
    let release;
    let closed = false;
    window.createImageBitmap = input => input === marker
      ? new Promise(resolve => { release = () => resolve({ width: 1, height: 1, close() { closed = true; } }); })
      : original(input);
    try {
      const pending = _bitmapJSCacheSet(key, marker, path);
      clearBitmapJSCacheForFile(path);
      release();
      await pending;
      return _bitmapJSCacheGet(key) === null && closed;
    } finally { window.createImageBitmap = original; }
  }), true, 'path containing a pipe repopulated a cleared bitmap cache');
  await page.evaluate(() => {
    window.__captureBlobCalls = 0;
    window.__captureOriginalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...args) {
      window.__captureBlobCalls++;
      return window.__captureOriginalToBlob.call(this, ...args);
    };
    window.__holdCaptureRegion = true;
    window.__capturePromise = import('/js/tools/screenshot.js').then(m => m.screenshotFullPage());
  });
  await page.waitForFunction(() => (window.__heldCaptureRegions?.length || 0) > 0);
  assert.equal(await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setNativeOcgVisibility } = await import('/js/pdf/native-ocg-selection.js');
    await setNativeOcgVisibility(getActiveDocument(), '6R', true);
    window.__holdCaptureRegion = false;
    for (const release of window.__heldCaptureRegions.splice(0)) release();
    await window.__capturePromise;
    HTMLCanvasElement.prototype.toBlob = window.__captureOriginalToBlob;
    return window.__captureBlobCalls;
  }), 0, 'capture exported stale on-screen pixels after selection changed');
  // Hold a native CAD conversion while changing OCG visibility. The setter
  // must cancel and join that conversion before its revision changes; another
  // CAD conversion cannot enter during the handoff.
  const completedCancelCalls = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setNativeOcgVisibility, nativeOcgSelectionForDocument } = await import('/js/pdf/native-ocg-selection.js');
    const { scanPagina, exporteerPagina, annuleer } = await import('/js/pdf/cad-export.js');
    await setNativeOcgVisibility(getActiveDocument(), '6R', false);
    const originalInvoke = window.__TAURI__.core.invoke;
    let completedCancelCalls = 0;
    window.__TAURI__.core.invoke = (command, args, options) => {
      if (command === 'scan_page_for_cad') return Promise.resolve({ layers: [] });
      if (command === 'cancel_cad_export') {
        completedCancelCalls++;
        return Promise.resolve(false);
      }
      return originalInvoke(command, args, options);
    };
    try {
      for (let i = 0; i < 300; i++) {
        const jobId = `completed-scan-${i}`;
        await scanPagina(jobId, { pdfPath: 'layers.pdf', pageIndex: 0 }, getActiveDocument());
        await annuleer(jobId);
      }
    } finally {
      window.__TAURI__.core.invoke = originalInvoke;
    }
    window.__cadRaceRevision = nativeOcgSelectionForDocument(getActiveDocument()).revision;
    window.__cadRaceCalls = [];
    window.__cadRaceOriginalInvoke = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = (command, args, options) => {
      if (command === 'export_page_to_cad') {
        window.__cadRaceCalls.push(command);
        return new Promise((resolve, reject) => { window.__cadRaceRelease = () => reject(new Error('cancelled')); });
      }
      if (command === 'cancel_cad_export') {
        window.__cadRaceCalls.push(`${command}:${args.jobId}`);
        // Native registration is held: false means the cancellation was
        // tombstoned, so the selection must still wait for the job response.
        return Promise.resolve(false);
      }
      return window.__cadRaceOriginalInvoke(command, args, options);
    };
    window.__cadRaceExport = exporteerPagina('ocg-race', {
      pdfPath: 'layers.pdf', outputPath: '/tmp/ocg-race.dxf',
    }).then(() => 'completed', error => error.message);
    window.__cadRaceToggle = setNativeOcgVisibility(getActiveDocument(), '6R', true);
    return completedCancelCalls;
  });
  assert.equal(completedCancelCalls, 0, 'completed CAD scans sent native cancellations and consumed tombstone capacity');
  await page.waitForFunction(() => window.__cadRaceCalls.includes('cancel_cad_export:ocg-race'));
  assert.deepEqual(await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { nativeOcgSelectionForDocument } = await import('/js/pdf/native-ocg-selection.js');
    const { exporteerPagina } = await import('/js/pdf/cad-export.js');
    const before = nativeOcgSelectionForDocument(getActiveDocument());
    let secondError = '';
    try {
      await exporteerPagina('ocg-race-second', { pdfPath: 'layers.pdf', outputPath: '/tmp/ocg-race-second.dxf' });
    } catch (error) { secondError = error.message; }
    return { before: before.ocgVisibility, sameRevision: before.revision === window.__cadRaceRevision,
      secondError, calls: window.__cadRaceCalls };
  }), {
    before: [],
    sameRevision: true,
    secondError: 'The native PDF layer selection is changing. Start CAD export again.',
    calls: ['export_page_to_cad', 'cancel_cad_export:ocg-race'],
  }, 'a layer toggle changed visibility before CAD settled or let a second CAD job enter');
  assert.deepEqual(await page.evaluate(async () => {
    window.__cadRaceRelease();
    const exportResult = await window.__cadRaceExport;
    await window.__cadRaceToggle;
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { nativeOcgSelectionForDocument } = await import('/js/pdf/native-ocg-selection.js');
    window.__TAURI__.core.invoke = window.__cadRaceOriginalInvoke;
    return { exportResult, selected: nativeOcgSelectionForDocument(getActiveDocument()).ocgVisibility };
  }), { exportResult: 'cancelled', selected: [{ object_number: 6, generation: 0, visible: true }] });
  // The CAD converter reads source bytes and cannot apply this selection.
  // Both the dialog and MCP command must reject before invoking native CAD.
  await page.evaluate(async () => {
    const { openDialog } = await import('/js/solid/stores/dialogStore.js');
    openDialog('cad-export');
  });
  await page.locator('.cad-dialog').waitFor();
  await page.locator('.cad-dialog .cad-input-wide').first().fill('/tmp/ocg-cad.dxf');
  await page.locator('.cad-dialog .cad-footer .pref-btn-primary').click();
  assert.match(await page.locator('.cad-dialog .cad-status-fout').innerText(), /native PDF layer selection/);
  await page.waitForTimeout(300); // the dialog's deferred layer scan must also stay off the native route
  assert.deepEqual(await page.evaluate(() => window.__nativeCalls.filter(call =>
    ['scan_page_for_cad', 'export_page_to_cad'].includes(call.command))), []);
  const cadCommand = await page.evaluate(async () => {
    const { closeDialog } = await import('/js/solid/stores/dialogStore.js');
    closeDialog('cad-export');
    const listeners = new Map();
    const originalInvoke = window.__TAURI__.core.invoke;
    window.__TAURI__.event = { listen: async (name, handler) => {
      listeners.set(name, handler);
      return () => {};
    } };
    let response;
    window.__TAURI__.core.invoke = async (command, args, options) => {
      if (command === 'app_response') { response = args.result; return true; }
      if (command === 'mcp_bridge_ready') return true;
      return originalInvoke(command, args, options);
    };
    try {
      const { initMcpBridge } = await import('/js/mcp-bridge.js');
      await initMcpBridge();
      await listeners.get('mcp:export-cad')({ payload: {
        request_id: 134, params: { path: '/tmp/ocg-cad.dxf' },
      } });
      return response;
    } finally {
      window.__TAURI__.core.invoke = originalInvoke;
      delete window.__TAURI__.event;
    }
  });
  assert.equal(cadCommand.ok, false);
  assert.match(cadCommand.error, /native PDF layer selection/);
  assert.equal(cadCommand.file_path, '/tmp/ocg-cad.dxf');
  assert.match(await page.evaluate(async () => {
    const { exporteerPagina } = await import('/js/pdf/cad-export.js');
    try {
      await exporteerPagina('ocg-guard', { pdfPath: 'layers.pdf', outputPath: '/tmp/ocg-cad.dxf' });
      return '';
    } catch (error) {
      return error.message;
    }
  }), /native PDF layer selection/, 'direct CAD converter call bypassed the guard');
  assert.deepEqual(await page.evaluate(() => window.__nativeCalls.filter(call =>
    ['scan_page_for_cad', 'export_page_to_cad'].includes(call.command))), []);
  // Validate encoded output bytes, rather than accepting the source canvas as
  // proof. Physical print and selected Save-as-PDF share bouwPrintPdf.
  const outputs = [];
  for (const visible of [false, true]) {
    const encoded = await page.evaluate(async selected => {
      const { getActiveDocument } = await import('/js/core/state.ts');
      const { setNativeOcgVisibility } = await import('/js/pdf/native-ocg-selection.js');
      const doc = getActiveDocument();
      await setNativeOcgVisibility(doc, '6R', selected);
      const writes = [];
      const invoke = window.__TAURI__.core.invoke;
      window.__TAURI__.core.invoke = async (command, args, options) => {
        if (command === 'write_file_atomic') {
          writes.push({ path: decodeURIComponent(options.headers['x-opds-path']), bytes: Array.from(args) });
          return true;
        }
        return invoke(command, args, options);
      };
      window.__TAURI__.dialog = { save: async () => '/tmp/ocg-output.png' };
      window.__TAURI__.fs = { writeFile: async (path, bytes) => {
        window.__ocgSavedPrint = { path, bytes: Array.from(bytes) };
      } };
      try {
        const { exportAsImages } = await import('/js/pdf/exporter.js');
        const { bouwPrintPdf, slaPrintOpAlsPdf } = await import('/js/pdf/print-job.js');
        await exportAsImages({ pages: [1], dpi: 72, format: 'png', includeAnnotations: false, doc });
        const { pdf } = await bouwPrintPdf({ doc, pages: [1], inhoud: 'doc-only' });
        const saved = selected ? await slaPrintOpAlsPdf({ pages: [1], pad: '/tmp/ocg-print.pdf', inhoud: 'doc-only' }) : null;
        return { image: writes[0], printPdf: Array.from(await pdf.save()), saved,
          savedPrint: selected ? window.__ocgSavedPrint : null };
      } finally {
        window.__TAURI__.core.invoke = invoke;
      }
    }, visible);
    assert.equal(encoded.image.path, '/tmp/ocg-output.png');
    const expected = visible ? [0, 0, 255] : [255, 255, 255];
    assert.deepEqual(await imagePixel(Buffer.from(encoded.image.bytes), 75, 75), expected,
      'image export encoded the PDF default instead of selected layer pixels');
    const embedded = await printImageBytes(Uint8Array.from(encoded.printPdf));
    const printPixel = await imagePixel(embedded, 75 * 4, 75 * 4);
    assert.ok(printPixel.every((channel, i) => Math.abs(channel - expected[i]) < 12),
      `print PDF embedded wrong selected layer pixels: ${printPixel}`);
    if (visible) {
      assert.equal(encoded.saved.ok, true);
      assert.equal(encoded.saved.gerasterd, true, 'selected Save-as-PDF must bypass default-state vector copy');
      assert.equal(encoded.savedPrint.path, '/tmp/ocg-print.pdf');
      const savedPixel = await imagePixel(await printImageBytes(Uint8Array.from(encoded.savedPrint.bytes)), 75 * 4, 75 * 4);
      assert.ok(savedPixel.every((channel, i) => Math.abs(channel - expected[i]) < 12),
        `selected Save-as-PDF wrote wrong pixels: ${savedPixel}`);
    }
    outputs.push(encoded);
  }
  assert.notDeepEqual(outputs[0].image.bytes, outputs[1].image.bytes,
    'OFF and ON image exports unexpectedly match');
  await page.evaluate(() => {
    window.__ocgExportWrites = [];
    window.__ocgOriginalInvoke = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = async (command, args, options) => {
      if (command === 'write_file_atomic') {
        window.__ocgExportWrites.push({ path: decodeURIComponent(options.headers['x-opds-path']), bytes: Array.from(args) });
        return true;
      }
      return window.__ocgOriginalInvoke(command, args, options);
    };
    window.__TAURI__.dialog = { save: async () => '/tmp/ocg-race.png' };
    window.__ocgOriginalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
      window.__ocgOriginalToBlob.call(this, blob => {
        window.__ocgReleaseBlob = () => callback(blob);
      }, ...args);
    };
    window.__ocgPendingExport = import('/js/pdf/exporter.js').then(m => m.exportAsImages({
      pages: [1], dpi: 72, format: 'png', includeAnnotations: false,
    }));
  });
  await page.waitForFunction(() => !!window.__ocgReleaseBlob);
  assert.deepEqual(await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setNativeOcgVisibility } = await import('/js/pdf/native-ocg-selection.js');
    await setNativeOcgVisibility(getActiveDocument(), '6R', false);
    window.__ocgReleaseBlob();
    const result = await window.__ocgPendingExport;
    HTMLCanvasElement.prototype.toBlob = window.__ocgOriginalToBlob;
    return { result, writes: window.__ocgExportWrites.length };
  }), { result: false, writes: 0 }, 'in-flight layer change wrote mixed or stale image output');
  const rasterPdf = await page.evaluate(async () => {
    const { getActiveDocument } = await import('/js/core/state.ts');
    const { setNativeOcgVisibility } = await import('/js/pdf/native-ocg-selection.js');
    await setNativeOcgVisibility(getActiveDocument(), '6R', true);
    window.__TAURI__.dialog.save = async () => '/tmp/ocg-raster.pdf';
    const { exportAsRasterPdf } = await import('/js/pdf/exporter.js');
    await exportAsRasterPdf({ pages: [1], dpi: 72 });
    const output = window.__ocgExportWrites.at(-1);
    window.__TAURI__.core.invoke = window.__ocgOriginalInvoke;
    return output;
  });
  assert.equal(rasterPdf.path, '/tmp/ocg-raster.pdf');
  const rasterPixel = await imagePixel(await printImageBytes(Uint8Array.from(rasterPdf.bytes)), 75, 75);
  assert.ok(rasterPixel.every((channel, i) => Math.abs(channel - [0, 0, 255][i]) < 12),
    `raster PDF exported default OCG pixels: ${rasterPixel}`);
  assert.deepEqual(await readFile(pdfPath), source, 'browser selection changed source bytes');
  assert.deepEqual(pageErrors, []);
  console.log('OCG selection passed: worker/browser display, encoded image/print/raster PDF pixels, CAD guard and in-flight cancellation, export race, source bytes unchanged');
} finally {
  await browser?.close();
  await server?.close();
  await rm(work, { recursive: true, force: true });
}
