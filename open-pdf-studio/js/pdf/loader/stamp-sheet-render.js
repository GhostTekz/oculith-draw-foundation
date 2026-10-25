// Stamp pictures from a stamp sheet (stamp-sheet.js): each page rendered
// with PDF.js on its own, on a transparent canvas, in the turn of the sheet
// the stamps are on. One PDF.js worker serves every stamp sheet; it goes
// after a minute without one.

import * as pdfjsLib from 'pdfjs-dist';

// The pixels of one stamp picture, as the sheet render capped them.
const MAX_PIXELS = 20_000_000;
const IDLE_MS = 60_000;

let sheetWorker = null;
let idleTimer = null;
let inUse = 0;

function takeWorker() {
  clearTimeout(idleTimer);
  inUse++;
  sheetWorker ??= new pdfjsLib.PDFWorker({ name: 'stamp-sheets' });
  return sheetWorker;
}

function releaseWorker() {
  inUse--;
  if (inUse > 0) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (inUse > 0 || !sheetWorker) return;
    sheetWorker.destroy();
    sheetWorker = null;
  }, IDLE_MS);
}

/**
 * Render the stamps of `sheet` ({ bytes, stamps }): a Map of
 * `id:<pdf.js id>` → { kind: 'stamp', dataUrl, space: 'visual', source: 'render' },
 * the same entries the sheet render makes.
 * @param {{ bytes: Uint8Array, stamps: string[] }} sheet
 * @param {{ rotation?: number, scale?: number, options?: object, onStep?: Function }} opts
 *   rotation: the turn of the sheet the stamps are on (PDFPageProxy.rotate);
 *   options: getDocument options (fonts, cmaps).
 */
export async function renderStampSheet(sheet, { rotation = 0, scale = 2, options = {}, onStep = null } = {}) {
  const out = new Map();
  if (!sheet?.bytes || !sheet.stamps?.length) return out;
  const worker = takeWorker();
  let loadingTask = null;
  try {
    const t0 = performance.now();
    loadingTask = pdfjsLib.getDocument({ ...options, data: sheet.bytes, worker });
    const pdf = await loadingTask.promise;
    onStep?.('load.stampSheetOpen', performance.now() - t0);
    for (let i = 0; i < sheet.stamps.length; i++) {
      const page = await pdf.getPage(i + 1);
      let s = scale;
      const one = page.getViewport({ scale: 1, rotation });
      if (one.width * one.height * s * s > MAX_PIXELS) s = Math.max(0.25, Math.sqrt(MAX_PIXELS / (one.width * one.height)));
      const viewport = page.getViewport({ scale: s, rotation });
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);
      if (!(width > 0) || !(height > 0)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        background: 'rgba(0,0,0,0)',
      }).promise;
      out.set(`id:${sheet.stamps[i]}`, { kind: 'stamp', dataUrl: canvas.toDataURL('image/png'), space: 'visual', source: 'render' });
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    try { await loadingTask?.destroy(); } catch { /* already gone */ }
    releaseWorker();
  }
  return out;
}
