// View history (the external editor's Previous View / Next View, Alt+Left / Alt+Right):
// a per-document stack of views, where a view is the page, the zoom and the
// scroll position (the vector viewport's pan offset, or the scroll offset of
// #pdf-container in continuous and legacy views).
//
// pdf/renderer.js calls noteViewBefore() before it changes the page or the
// zoom and noteViewAfter() when the change is done. Before a change the
// current entry is refreshed with the live view, so panning and scrolling
// between two recorded changes is not lost; after it the new view is pushed
// and any forward entries are dropped (like a browser). Restoring a view
// runs with recording switched off, so going back never records itself.
//
// createViewHistory() is pure (no DOM, no Solid) and covered by
// view-history.test.mjs.

import { createSignal } from 'solid-js';
import { state } from './state.js';

export const VIEW_HISTORY_LIMIT = 100;
// Repeated zoom steps (Ctrl+= pressed five times) collapse into one entry.
export const ZOOM_COALESCE_MS = 700;

/** Two views are the same when page, zoom and scroll position agree. */
export function sameView(a, b) {
  if (!a || !b) return false;
  return a.page === b.page
    && Math.abs((a.zoom || 0) - (b.zoom || 0)) < 1e-3
    && Math.abs((a.x || 0) - (b.x || 0)) < 2
    && Math.abs((a.y || 0) - (b.y || 0)) < 2;
}

/**
 * A previous/next view stack.
 * visit(view, { kind, now })  push a new view (drops the forward entries);
 *                             a view equal to the current one only refreshes it;
 *                             a 'zoom' visit right after another 'zoom' visit
 *                             replaces it (ZOOM_COALESCE_MS).
 * replace(view)               refresh the current entry (the live view).
 * back(live) / forward(live)  move; `live` first refreshes the entry being
 *                             left. Returns the view to show, or null.
 */
export function createViewHistory({ limit = VIEW_HISTORY_LIMIT } = {}) {
  let entries = [];
  let index = -1;
  let lastKind = null;
  let lastAt = -Infinity;

  const api = {
    get entries() { return entries.slice(); },
    get index() { return index; },
    current: () => (index >= 0 ? entries[index] : null),
    canBack: () => index > 0,
    canForward: () => index >= 0 && index < entries.length - 1,
    replace(view) {
      if (!view) return false;
      if (index < 0) { entries = [view]; index = 0; return true; }
      entries[index] = view;
      return true;
    },
    visit(view, { kind = 'page', now = Date.now() } = {}) {
      if (!view) return false;
      const coalesce = kind === 'zoom' && lastKind === 'zoom' && now - lastAt < ZOOM_COALESCE_MS
        && index > 0 && index === entries.length - 1;
      lastKind = kind;
      lastAt = now;
      if (index >= 0 && sameView(entries[index], view)) {
        entries[index] = view;
        return false;
      }
      if (coalesce) {
        entries[index] = view;
        // Zoomed back to where the run started: nothing left to go back to.
        if (sameView(entries[index - 1], view)) { entries.pop(); index--; }
        return true;
      }
      entries = entries.slice(0, index + 1);
      entries.push(view);
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
      index = entries.length - 1;
      return true;
    },
    back(live) {
      if (!api.canBack()) return null;
      if (live) entries[index] = live;
      index--;
      lastKind = null;
      return entries[index];
    },
    forward(live) {
      if (!api.canForward()) return null;
      if (live) entries[index] = live;
      index++;
      lastKind = null;
      return entries[index];
    },
    clear() { entries = []; index = -1; lastKind = null; },
  };
  return api;
}

// ── App integration ─────────────────────────────────────────────────────────

const histories = new WeakMap();
// Bumped on every change so the Navigation bar re-reads canBack/canForward.
const [historyVersion, setHistoryVersion] = createSignal(0);
const bump = () => setHistoryVersion((v) => v + 1);
let restoring = 0;

function activeDoc() {
  return state.documents?.[state.activeDocumentIndex] || null;
}

export function historyFor(doc) {
  if (!doc || typeof doc !== 'object') return null;
  // state is a createMutable store: the same document always comes back as
  // the same proxy, so it can key the WeakMap.
  let h = histories.get(doc);
  if (!h) { h = createViewHistory(); histories.set(doc, h); }
  return h;
}

/** The live view of `doc`: page, zoom and scroll position. */
export function captureView(doc = activeDoc()) {
  if (!doc?.pdfDoc) return null;
  const page = doc.currentPage || 1;
  const vp = typeof window !== 'undefined' ? window.__pdfViewport : null;
  if (vp && vp.active && doc.filePath && doc.viewMode !== 'continuous') {
    return { page, zoom: vp.zoom, x: vp.offsetX, y: vp.offsetY, mode: 'viewport' };
  }
  const container = typeof document !== 'undefined' ? document.getElementById('pdf-container') : null;
  return {
    page,
    zoom: doc.scale || 1,
    x: container?.scrollLeft || 0,
    y: container?.scrollTop || 0,
    mode: 'scroll',
  };
}

export const isRestoringView = () => restoring > 0;

/** Call before a page or zoom change: refresh the current entry. */
export function noteViewBefore(doc = activeDoc()) {
  if (restoring || !doc?.pdfDoc) return;
  const view = captureView(doc);
  if (view) historyFor(doc).replace(view);
}

/** Call after a page or zoom change: record the new view. */
export function noteViewAfter(doc = activeDoc(), kind = 'page') {
  if (restoring || !doc?.pdfDoc) return;
  // Only the active document's view is live; a background tab keeps its stack.
  if (doc !== activeDoc()) return;
  const view = captureView(doc);
  if (view) historyFor(doc).visit(view, { kind });
  bump();
}

export function canGoBackView(doc = activeDoc()) {
  historyVersion();
  return !!doc && !!histories.get(doc)?.canBack();
}

export function canGoForwardView(doc = activeDoc()) {
  historyVersion();
  return !!doc && !!histories.get(doc)?.canForward();
}

async function restoreView(doc, view) {
  restoring++;
  try {
    const r = await import('../pdf/renderer.js');
    if (view.page !== doc.currentPage) await r.goToPage(view.page, { skipScroll: true });
    if (doc !== activeDoc()) return;
    const vp = window.__pdfViewport;
    if (view.mode === 'viewport' && vp && vp.active && doc.filePath && doc.viewMode !== 'continuous') {
      const m = await import('../pdf/pdf-viewport.js');
      if (Math.abs(vp.zoom - view.zoom) > 1e-6) {
        const canvas = document.getElementById('pdf-canvas');
        const dpr = window.devicePixelRatio || 1;
        m.setZoomAtPoint((canvas?.width || 0) / dpr / 2, (canvas?.height || 0) / dpr / 2, view.zoom);
      }
      vp.offsetX = view.x;
      vp.offsetY = view.y;
      m.markAnchored();
      vp.dirty = true;
      return;
    }
    if (Math.abs((doc.scale || 1) - view.zoom) > 1e-6) await r.setZoom(view.zoom);
    const container = document.getElementById('pdf-container');
    if (container) {
      // After the re-render has laid the pages out.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      container.scrollLeft = view.x;
      container.scrollTop = view.y;
    }
  } finally {
    restoring--;
    bump();
  }
}

/** Previous View (Alt+Left). */
export async function goBackView(doc = activeDoc()) {
  const h = doc?.pdfDoc ? histories.get(doc) : null;
  if (!h?.canBack() || restoring) return false;
  const view = h.back(captureView(doc));
  bump();
  if (view) await restoreView(doc, view);
  return !!view;
}

/** Next View (Alt+Right). */
export async function goForwardView(doc = activeDoc()) {
  const h = doc?.pdfDoc ? histories.get(doc) : null;
  if (!h?.canForward() || restoring) return false;
  const view = h.forward(captureView(doc));
  bump();
  if (view) await restoreView(doc, view);
  return !!view;
}

export { historyVersion };
