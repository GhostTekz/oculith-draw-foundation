// Browser route acceptance with real pixels from the bundled Linux PDFium
// worker. The browser bridge rejects OCG draw-command extraction like Tauri;
// the diagnostic vector viewport must activate PDFium raster and thumbnails.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import { createServer } from 'vite';

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
  const namespace = `ocg-diagnostic-${process.pid}`;
  const worker = spawn(workerBinary, ['0', namespace], {
    cwd: resolve('src-tauri/binaries/linux-x64'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: worker.stdout })[Symbol.asyncIterator]();
  try {
    const ready = JSON.parse((await lines.next()).value);
    assert.equal(ready.op, 'ready');
    worker.stdin.write(JSON.stringify({ op: 'render', id: 1, path: pdfPath, page_index: 0, scale: 1, rotation: 0 }) + '\n');
    const result = JSON.parse((await lines.next()).value);
    assert.equal(result.ok, true, JSON.stringify(result));
    const shm = await readFile(join(tmpdir(), ready.shm_name));
    const rgba = shm.subarray(32, 32 + result.shm_bytes);
    const wire = Buffer.alloc(8 + rgba.length);
    wire.writeUInt32LE(result.w, 0);
    wire.writeUInt32LE(result.h, 4);
    rgba.copy(wire, 8);
    assert.equal(result.w, 100);
    assert.equal(result.h, 100);
    const pixel = (x, y) => [...rgba.subarray((y * result.w + x) * 4, (y * result.w + x) * 4 + 3)];
    assert.deepEqual(pixel(25, 75), [255, 0, 0]);
    assert.deepEqual(pixel(75, 75), [255, 255, 255]);
    return wire;
  } finally {
    worker.kill();
    await rm(join(tmpdir(), `pdfium-worker-${namespace}-0.shm`), { force: true });
  }
}

const work = await mkdtemp(join(tmpdir(), 'ocudraw-ocg-diagnostic-'));
const source = ocgFixture();
const pdfPath = join(work, 'layers.pdf');
await writeFile(pdfPath, source);
const workerBinary = resolve(process.env.OCUDRAW_WORKER_BINARY || '../target/debug/pdfium-worker');
let server;
let browser;
try {
  const wire = await nativePixels(workerBinary, pdfPath);
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
  }, Array.from(source));
  await page.locator('#pdf-container.visible').waitFor();
  await page.evaluate(async nativeWire => {
    const wireBytes = Uint8Array.from(nativeWire);
    const width = new DataView(wireBytes.buffer).getUint32(0, true);
    const height = new DataView(wireBytes.buffer).getUint32(4, true);
    const nativeCanvas = document.createElement('canvas');
    nativeCanvas.width = width;
    nativeCanvas.height = height;
    nativeCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(wireBytes.buffer, 8), width, height), 0, 0);
    window.__nativeCalls = [];
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      window.__nativeCalls.push(command);
      if (command === 'analyze_page_type') return 'vector';
      if (command === 'extract_draw_commands') throw 'OCG content requires PDFium renderer';
      if (command === 'render_pdf_page') return wireBytes;
      if (command === 'render_thumbnail') return JSON.stringify({ dataURL: nativeCanvas.toDataURL('image/png'), width, height });
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
  }, Array.from(wire));
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
    return { red: pixel(25, 75), hidden: pixel(75, 75), calls: window.__nativeCalls.slice() };
  });
  assert.deepEqual(result.red, [255, 0, 0]);
  assert.deepEqual(result.hidden, [255, 255, 255]);
  assert.ok(result.calls.includes('extract_draw_commands'));
  assert.ok(result.calls.includes('render_pdf_page'));
  await page.waitForFunction(() => window.__nativeCalls.includes('render_thumbnail'));
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
  assert.deepEqual(pageErrors, []);
  console.log('OCG diagnostic fallback passed: native red/white pixels, rejected vector extraction, PDFium raster and thumbnail');
} finally {
  await browser?.close();
  await server?.close();
  await rm(work, { recursive: true, force: true });
}
