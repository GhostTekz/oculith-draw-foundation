// PDFium (WebAssembly) in een Web Worker: de pixels van de webversie.
//
// De bureaubladversie rastert met PDFium (pdfium-worker/src/render.rs). De
// webversie rasterde met PDF.js, en dat oogt anders dan the external editor: haarlijnen
// lichter (PDF.js smeert een lijn van 1 px over twee pixelrijen) en tekst in
// een niet-ingebedde Helvetica met een andere vervanger. Deze worker draait
// dezelfde PDFium als WebAssembly (@embedpdf/pdfium, MIT; PDFium BSD-3), zodat
// de webversie pixel voor pixel gelijk tekent aan het bureaublad.
//
// Berichten (allemaal met `id` voor het antwoord):
//   { type: 'open', docKey, bytes }                -> { ok, pages }
//   { type: 'close', docKey }                      -> { ok }
//   { type: 'render', docKey, pageIndex, width, height, matrix, show } ->
//        { ok, width, height, rgba (ArrayBuffer, overgedragen), ms }
// `matrix` = [a, b, c, d, e, f] van weergave-punten naar bitmap-pixels (zie
// pdfium-matrix.js). `show` = null (geen annotaties, zoals PDF.js met
// annotationMode 0) of een lijst /NM's: alleen die annotaties met hun eigen
// uiterlijk (/AP), de rest verborgen — dezelfde regel als render.rs
// apply_annotation_appearance, plus formuliervelden verborgen (de webversie
// tekent die als HTML-laag).

import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';

const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;
const FPDF_ANNOT_FLAG_HIDDEN = 0x02;
const FPDF_ANNOT_WIDGET = 20;
const FPDF_ANNOT_POPUP = 16;

let modulePromise = null;
const docs = new Map(); // docKey -> { doc, ptr, pages: Map(pageIndex -> page), lru: [] }
const MAX_OPEN_PAGES = 3;

function laadModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const res = await fetch(wasmUrl);
      if (!res.ok) throw new Error(`pdfium.wasm: HTTP ${res.status}`);
      const wasmBinary = await res.arrayBuffer();
      const m = await init({ wasmBinary });
      m.PDFiumExt_Init();
      return m;
    })();
  }
  return modulePromise;
}

function sluitDoc(m, d) {
  for (const page of d.pages.values()) m.FPDF_ClosePage(page);
  d.pages.clear();
  m.FPDF_CloseDocument(d.doc);
  m.pdfium.wasmExports.free(d.ptr);
}

function pagina(m, d, pageIndex) {
  let page = d.pages.get(pageIndex);
  if (page) {
    d.lru = d.lru.filter((i) => i !== pageIndex).concat(pageIndex);
    return page;
  }
  page = m.FPDF_LoadPage(d.doc, pageIndex);
  if (!page) throw new Error(`FPDF_LoadPage ${pageIndex} faalde (${m.FPDF_GetLastError()})`);
  d.pages.set(pageIndex, page);
  d.lru.push(pageIndex);
  // Een zware CAD-pagina laden kost honderden ms: een paar open houden.
  while (d.lru.length > MAX_OPEN_PAGES) {
    const oud = d.lru.shift();
    const p = d.pages.get(oud);
    if (p) m.FPDF_ClosePage(p);
    d.pages.delete(oud);
  }
  return page;
}

function nmVan(m, annot) {
  const E = m.pdfium;
  const nodig = m.FPDFAnnot_GetStringValue(annot, 'NM', 0, 0);
  if (!nodig || nodig <= 2) return null;
  const buf = E.wasmExports.malloc(nodig);
  try {
    m.FPDFAnnot_GetStringValue(annot, 'NM', buf, nodig);
    return E.UTF16ToString(buf);
  } finally {
    E.wasmExports.free(buf);
  }
}

// Alleen de genoemde annotaties zichtbaar; alles anders verborgen.
// `show` = lijst /NM's, of { nms, plekken }: plekken = posities in /Annots
// voor markeringen zonder unieke /NM (zoals annot_appearance_index in de
// bureaubladworker).
function zetAnnotatieZichtbaarheid(m, page, show) {
  const toon = new Set(Array.isArray(show) ? show : (show?.nms || []));
  const plekken = new Set(Array.isArray(show) ? [] : (show?.plekken || []));
  const n = m.FPDFPage_GetAnnotCount(page);
  for (let i = 0; i < n; i++) {
    const annot = m.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      const subtype = m.FPDFAnnot_GetSubtype(annot);
      const houden = subtype !== FPDF_ANNOT_WIDGET && subtype !== FPDF_ANNOT_POPUP
        && (plekken.has(i) || toon.has(nmVan(m, annot)));
      const vlaggen = m.FPDFAnnot_GetFlags(annot);
      const verborgen = (vlaggen & FPDF_ANNOT_FLAG_HIDDEN) !== 0;
      if (verborgen === houden) {
        m.FPDFAnnot_SetFlags(annot, houden ? (vlaggen & ~FPDF_ANNOT_FLAG_HIDDEN) : (vlaggen | FPDF_ANNOT_FLAG_HIDDEN));
      }
    } finally {
      m.FPDFPage_CloseAnnot(annot);
    }
  }
}

async function render({ docKey, pageIndex, width, height, matrix, show }) {
  const m = await laadModule();
  const d = docs.get(docKey);
  if (!d) throw new Error('document niet geopend');
  const page = pagina(m, d, pageIndex);
  const E = m.pdfium;
  const t0 = performance.now();
  let flags = FPDF_REVERSE_BYTE_ORDER;
  if (Array.isArray(show) || (show && typeof show === 'object')) {
    zetAnnotatieZichtbaarheid(m, page, show);
    flags |= FPDF_ANNOT;
  }
  const bitmap = m.FPDFBitmap_CreateEx(width, height, 4, 0, 0);
  if (!bitmap) throw new Error(`FPDFBitmap_CreateEx ${width}x${height} faalde`);
  const mp = E.wasmExports.malloc(40);
  try {
    m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xFFFFFFFF);
    for (let i = 0; i < 6; i++) E.setValue(mp + i * 4, matrix[i], 'float');
    E.setValue(mp + 24, 0, 'float');
    E.setValue(mp + 28, 0, 'float');
    E.setValue(mp + 32, width, 'float');
    E.setValue(mp + 36, height, 'float');
    m.FPDF_RenderPageBitmapWithMatrix(bitmap, page, mp, mp + 24, flags);
    const buf = m.FPDFBitmap_GetBuffer(bitmap);
    const stride = m.FPDFBitmap_GetStride(bitmap);
    const heap = E.HEAPU8;
    let rgba;
    if (stride === width * 4) {
      rgba = heap.slice(buf, buf + stride * height);
    } else {
      rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) rgba.set(heap.subarray(buf + y * stride, buf + y * stride + width * 4), y * width * 4);
    }
    return { width, height, rgba: rgba.buffer, ms: Math.round(performance.now() - t0) };
  } finally {
    E.wasmExports.free(mp);
    m.FPDFBitmap_Destroy(bitmap);
  }
}

async function open({ docKey, bytes }) {
  const m = await laadModule();
  const oud = docs.get(docKey);
  if (oud) { sluitDoc(m, oud); docs.delete(docKey); }
  const data = new Uint8Array(bytes);
  const ptr = m.pdfium.wasmExports.malloc(data.length);
  m.pdfium.HEAPU8.set(data, ptr);
  const doc = m.FPDF_LoadMemDocument(ptr, data.length, '');
  if (!doc) {
    m.pdfium.wasmExports.free(ptr);
    throw new Error(`FPDF_LoadMemDocument faalde (${m.FPDF_GetLastError()})`);
  }
  docs.set(docKey, { doc, ptr, pages: new Map(), lru: [] });
  return { pages: m.FPDF_GetPageCount(doc) };
}

async function close({ docKey }) {
  const d = docs.get(docKey);
  if (!d) return {};
  const m = await laadModule();
  sluitDoc(m, d);
  docs.delete(docKey);
  return {};
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    let uit;
    if (msg.type === 'open') uit = await open(msg);
    else if (msg.type === 'close') uit = await close(msg);
    else if (msg.type === 'render') uit = await render(msg);
    else if (msg.type === 'ping') { await laadModule(); uit = {}; }
    else throw new Error(`onbekend bericht ${msg.type}`);
    self.postMessage({ id: msg.id, ok: true, ...uit }, uit?.rgba ? [uit.rgba] : []);
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
};
