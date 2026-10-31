// Visual Search session: pick a symbol (drag a rectangle on the page), search
// the current page or every page for it, and turn the chosen results into
// numbered count markers or rectangle highlights. State lives in
// solid/stores/visualSearchStore.js; the matching runs in a Web Worker
// (search-engine.js). Pages are rendered by PDF.js (page-raster.js) in the
// annotation model space at a reduced scale, so results come back in page
// points with the CropBox and page rotation already applied.
//
// PDFs are local, untrusted input: the rasters never leave this process.

import { state, getActiveDocument, getPageRotation } from '../../core/state.js';
import { renderPageRaster, appPageSize, searchScale } from './page-raster.js';
import { nativeOcgPdfJsConfig } from '../../pdf/native-ocg-selection.js';
import { rgbaToInk, cropInk, thumbnail } from './matcher.js';
import { searchRaster, cancelSearches } from './search-engine.js';
import { matchToResult, countAnnotationsFor, highlightAnnotationsFor } from './results.js';
import {
  template, setTemplate, status, setStatus, scope, rotations, scaleStep, results, setResults,
  setProgress, setLastMessage, setElapsedMs, chosenResults, resultsDocId, setResultsDocId, docKey,
} from '../../solid/stores/visualSearchStore.js';
import {
  countCategories, activeCountCategory, nextCountNumber, setActiveCountCategory,
} from '../../solid/stores/countStore.js';

let searchGen = 0;

function redraw() {
  return import('../../annotations/rendering.js').then((m) => {
    if (getActiveDocument()?.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => {});
}

/** Repaint the result frames (after the slider or an include checkbox). */
export const redrawResults = () => redraw();

/**
 * Render a page for searching. Tests (and callers without a DOM) pass
 * `createCanvas`.
 * @returns {Promise<{ width:number, height:number, rgba:Uint8ClampedArray, scale:number }>}
 */
export async function renderSearchPage(doc, pageNum, scale, createCanvas) {
  const page = await doc.pdfDoc.getPage(pageNum);
  // Only the PDF layers that are shown (docs/foundation/PDF-LAYERS.md).
  return renderPageRaster(page, scale, { extraRotation: getPageRotation(pageNum) || 0, createCanvas,
    optionalContentConfigPromise: nativeOcgPdfJsConfig(doc) });
}

/**
 * Cut the template for a picked rectangle (app points) on `pageNum`.
 * @returns {Promise<import('../../solid/stores/visualSearchStore.js').VisualSearchTemplate|null>}
 */
export async function buildTemplate(doc, pageNum, rect, createCanvas) {
  if (!doc?.pdfDoc || !(rect?.width > 0) || !(rect?.height > 0)) return null;
  const page = await doc.pdfDoc.getPage(pageNum);
  const size = appPageSize(page, getPageRotation(pageNum) || 0);
  const scale = searchScale(rect, size);
  const raster = await renderPageRaster(page, scale, { extraRotation: getPageRotation(pageNum) || 0, createCanvas,
    optionalContentConfigPromise: nativeOcgPdfJsConfig(doc) });
  const image = { width: raster.width, height: raster.height, data: rgbaToInk(raster.rgba, raster.width, raster.height) };
  const crop = cropInk(image, rect.x * scale, rect.y * scale, rect.width * scale, rect.height * scale);
  if (!(crop.width >= 3) || !(crop.height >= 3)) return null;
  // A pick on blank paper has nothing to find.
  let ink = 0;
  for (let i = 0; i < crop.data.length; i++) ink = Math.max(ink, crop.data[i]);
  if (ink < 0.1) return null;
  return {
    docId: docKey(doc),
    page: pageNum,
    rect: { x: crop.x / scale, y: crop.y / scale, width: crop.width / scale, height: crop.height / scale },
    scale,
    width: crop.width,
    height: crop.height,
    data: crop.data,
    thumb: thumbnail(image, crop.x, crop.y, crop.width, crop.height, 64),
  };
}

/** Drag a rectangle around a symbol on the current page; it becomes the template. */
export async function pickSymbol() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  cancelSearch(false);
  const before = status();
  setStatus('picking');
  setLastMessage(null);
  const { pickPageRegion } = await import('../region-pick.js');
  const pick = await pickPageRegion();
  if (!pick) {
    setStatus(before === 'picking' ? 'idle' : before);
    return null;
  }
  const t = await buildTemplate(doc, pick.page, pick.rect);
  if (!t) {
    setStatus('idle');
    setLastMessage({ key: 'emptyPick' });
    return null;
  }
  setTemplate(t);
  setResults([]);
  setStatus('idle');
  return t;
}

/** Stop a running search (keeps the results found so far). */
export function cancelSearch(mark = true) {
  if (status() !== 'searching') return;
  searchGen++;
  cancelSearches();
  if (mark) setStatus('cancelled');
}

/**
 * Search the current page or the whole document for the template.
 * @param {{ pages?: number[], createCanvas?: Function }} [opts]
 * @returns {Promise<import('../../solid/stores/visualSearchStore.js').VisualSearchResult[]>}
 */
export async function runSearch(opts = {}) {
  const doc = getActiveDocument();
  const t = template();
  if (!doc?.pdfDoc || !t || t.docId !== docKey(doc)) return [];
  cancelSearch(false);
  const gen = ++searchGen;
  const pages = opts.pages
    || (scope() === 'all' ? Array.from({ length: doc.pdfDoc.numPages }, (_, i) => i + 1) : [doc.currentPage || 1]);
  const searchOpts = { rotations: rotations(), scaleStep: scaleStep() };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  setResultsDocId(docKey(doc));
  setResults([]);
  setStatus('searching');
  setLastMessage(null);
  setProgress({ done: 0, total: pages.length });
  const found = [];
  let nextId = 1;
  const render = (p) => renderSearchPage(doc, p, t.scale, opts.createCanvas);
  try {
    // Render the next page while the worker searches this one.
    let next = render(pages[0]);
    for (let i = 0; i < pages.length; i++) {
      const raster = await next;
      if (gen !== searchGen) return found;
      next = i + 1 < pages.length ? render(pages[i + 1]) : null;
      // An unhandled rejection of a page we no longer await is reported below.
      next?.catch(() => {});
      const matches = await searchRaster(raster, t, searchOpts);
      if (gen !== searchGen) return found;
      for (const m of matches) {
        found.push({ id: nextId++, ...matchToResult(m, pages[i], t.scale), included: true, thumb: m.thumb });
      }
      found.sort((a, b) => b.score - a.score);
      setResults([...found]);
      setProgress({ done: i + 1, total: pages.length });
      if (pages[i] === (getActiveDocument()?.currentPage || 1)) redraw();
    }
    setStatus('done');
    setElapsedMs(Math.round(now() - t0));
  } catch (err) {
    if (gen !== searchGen || err?.cancelled) return found;
    console.error('[visualSearch]', err);
    setStatus('error');
  }
  redraw();
  return found;
}

/** The count category to use: the given id, else the active one. */
function categoryFor(categoryId) {
  return countCategories().find((c) => c.id === categoryId) || activeCountCategory();
}

async function addAnnotations(doc, anns) {
  if (!anns.length) return anns;
  const { recordBulkAdd } = await import('../../core/undo-manager.js');
  doc.annotations.push(...anns);
  recordBulkAdd(anns);
  setResults([]);
  redraw();
  return anns;
}

/**
 * Create count markers in a category (numbered on after the category's
 * existing counts, in page / reading order) for the chosen results.
 */
export async function createCountMarkups(categoryId) {
  const doc = getActiveDocument();
  if (!doc || docKey(doc) !== resultsDocId()) return [];
  const chosen = chosenResults();
  const cat = categoryFor(categoryId);
  if (!chosen.length || !cat) return [];
  const anns = countAnnotationsFor(chosen, cat, nextCountNumber(cat.id));
  setActiveCountCategory(cat.id);
  await addAnnotations(doc, anns);
  setLastMessage({ key: 'createdCounts', count: anns.length });
  return anns;
}

/** Rectangle highlights over the chosen results. */
export async function highlightResults(color) {
  const doc = getActiveDocument();
  if (!doc || docKey(doc) !== resultsDocId()) return [];
  const chosen = chosenResults();
  if (!chosen.length) return [];
  const anns = highlightAnnotationsFor(chosen, color || state.preferences?.highlightColor || '#ffff00');
  await addAnnotations(doc, anns);
  setLastMessage({ key: 'createdHighlights', count: anns.length });
  return anns;
}

/** Results to draw on `pageNum` of the active document (overlay.js). */
export function overlayResults(pageNum) {
  const doc = getActiveDocument();
  if (!doc || docKey(doc) !== resultsDocId()) return [];
  return results().filter((r) => r.page === pageNum);
}

/** Go to a result's page. */
export async function revealResult(r) {
  const doc = getActiveDocument();
  if (!doc || docKey(doc) !== resultsDocId()) return;
  if ((doc.currentPage || 1) !== r.page) {
    const { goToPage } = await import('../../pdf/renderer.js');
    await goToPage(r.page);
  }
  redraw();
}

/** Clear the results (keeps the template). */
export function clearResults() {
  cancelSearch(false);
  setResults([]);
  setStatus('idle');
  redraw();
}
