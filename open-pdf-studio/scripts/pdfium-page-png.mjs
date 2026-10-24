// Render one PDF page to a PNG with PDFium (@embedpdf/pdfium, MIT; PDFium BSD-3).
// Page size follows PDFium: the crop box, after /Rotate. One pixel per point at 72 dpi.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

let modulePromise = null;

function loadPdfium() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasmBinary = await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
      const pdfium = await init({ wasmBinary });
      pdfium.PDFiumExt_Init();
      return pdfium;
    })();
  }
  return modulePromise;
}

export async function renderPagePng(bytes, { pageIndex = 0, dpi = 72, annotations = true } = {}) {
  const pdfium = await loadPdfium();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const heap = pdfium.pdfium;
  const pointer = heap.wasmExports.malloc(data.length);
  heap.HEAPU8.set(data, pointer);
  const doc = pdfium.FPDF_LoadMemDocument(pointer, data.length, '');
  if (!doc) {
    heap.wasmExports.free(pointer);
    throw new Error(`FPDF_LoadMemDocument failed (${pdfium.FPDF_GetLastError()})`);
  }
  const page = pdfium.FPDF_LoadPage(doc, pageIndex);
  if (!page) {
    pdfium.FPDF_CloseDocument(doc);
    heap.wasmExports.free(pointer);
    throw new Error(`FPDF_LoadPage ${pageIndex} failed (${pdfium.FPDF_GetLastError()})`);
  }
  const scale = dpi / 72;
  const width = Math.max(1, Math.round(pdfium.FPDF_GetPageWidth(page) * scale));
  const height = Math.max(1, Math.round(pdfium.FPDF_GetPageHeight(page) * scale));
  const bitmap = pdfium.FPDFBitmap_CreateEx(width, height, 4, 0, 0);
  if (!bitmap) {
    pdfium.FPDF_ClosePage(page);
    pdfium.FPDF_CloseDocument(doc);
    heap.wasmExports.free(pointer);
    throw new Error(`FPDFBitmap_CreateEx ${width}x${height} failed`);
  }
  try {
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
    const flags = FPDF_REVERSE_BYTE_ORDER | (annotations ? FPDF_ANNOT : 0);
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, flags);
    const buffer = pdfium.FPDFBitmap_GetBuffer(bitmap);
    const stride = pdfium.FPDFBitmap_GetStride(bitmap);
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      rgba.set(heap.HEAPU8.subarray(buffer + y * stride, buffer + y * stride + width * 4), y * width * 4);
    }
    return sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer();
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap);
    pdfium.FPDF_ClosePage(page);
    pdfium.FPDF_CloseDocument(doc);
    heap.wasmExports.free(pointer);
  }
}
