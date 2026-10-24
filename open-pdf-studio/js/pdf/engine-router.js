// Single source of truth for dispatching whole-page PDF renders to the
// chosen engine. Consults state.renderEngineOverride:
//
//   null         → 'render_pdf_page'      (PDFium, the default)
//   'pdfium'     → 'render_pdf_page'      (PDFium, forced)
//   'rust-skia'  → 'render_pdf_page_skia' (open-pdf-render kernel, alpha)
//
// Used by every caller that does whole-page raster rendering — bitmap-
// orchestrator's ensureBitmap, loader.js cold-open preview, renderer.js
// single-page render. Centralised so the bottom-right engine selector
// affects ALL render paths consistently.
//
// Tile-region rendering (render_pdf_page_region) stays PDFium-only because
// open-pdf-render doesn't have a region renderer yet. The override is
// silently ignored on the tile path; the user-visible engine label still
// reflects the chosen engine for the whole-page bitmap underneath.

import { state } from '../core/state.js';
import { invoke } from '../core/platform.js';
import { nativeOcgSelectionForPath } from './native-ocg-selection.js';
import { nativeAnnotArgs } from './ap-render-state.js';

/**
 * Render one whole page via the user-selected engine.
 * @param {{path:string, pageIndex:number, scale:number, rotation?:number}} args
 * @returns {Promise<Uint8Array>} `[w:u32 LE][h:u32 LE][rgba…]` wire format
 */
export async function renderPdfPage({ path, pageIndex, scale, rotation = 0, ocgVisibility, annotAppearance }) {
  ocgVisibility ??= nativeOcgSelectionForPath(path).ocgVisibility;
  // Weergave-renders tekenen onbewerkte ingelezen markeringen uit hun /AP
  // (ap-render-state.js). Wie de markeringen zelf tekent (miniaturen) geeft
  // annotAppearance: null mee.
  const annot = annotAppearance === undefined ? nativeAnnotArgs(path, pageIndex) : null;
  // De open-pdf-render-kernel kent geen /AP: dan PDFium.
  const command = (state?.renderEngineOverride === 'rust-skia' && !annot)
    ? 'render_pdf_page_skia'
    : 'render_pdf_page';
  const args = { path, pageIndex, scale, rotation, ocgVisibility, ...(annot || {}) };
  if (command === 'render_pdf_page_skia') {
    try {
      return await invoke(command, args);
    } catch (error) {
      if (!String(error).includes('OCG content requires PDFium renderer')) throw error;
      return invoke('render_pdf_page', args);
    }
  }
  return invoke(command, args);
}

/**
 * Diagnostic: which engine WOULD a whole-page render use right now?
 * Useful for status-bar labels and PERF logging without dispatching a
 * render.
 */
export function currentRenderEngine() {
  return (state?.renderEngineOverride === 'rust-skia') ? 'rust-skia' : 'pdfium';
}
