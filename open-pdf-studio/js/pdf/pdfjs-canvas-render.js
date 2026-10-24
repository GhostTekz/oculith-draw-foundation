// Largest bitmap side PDF.js draws (px). PDF.js paints on the main thread,
// and its time and memory grow with the bitmap area; at a deep zoom on a
// large sheet the full-resolution bitmap (8 000-17 000 px wide) froze the
// page or failed to allocate. 6144 keeps a 24" x 36" sheet sharp at 150 % on
// a HiDPI screen; above it the bitmap is CSS-stretched (slightly soft, like
// the native path's cap). The single-page view draws the visible part on top
// at full resolution (pdfjs-detail-layer.js), so it can use a smaller base.
export const PDFJS_MAX_BITMAP_AXIS_PX = 6144;

/** Pixels per CSS px for a page of `width` x `height` CSS px: the dpr, capped. */
export function pdfJsBitmapRatio(width, height, dpr, maxAxisPx = PDFJS_MAX_BITMAP_AXIS_PX) {
  const r = dpr > 0 ? dpr : 1;
  const longest = Math.max(width, height);
  return longest > 0 ? Math.min(r, maxAxisPx / longest) : r;
}

/**
 * A canvas for PDF.js to rasterise into. CPU-backed on purpose
 * (willReadFrequently): a CAD sheet is hundreds of thousands to millions of
 * thin strokes, and on a GPU-accelerated 2D canvas each stroke becomes GPU
 * work. Measured on a 1.8 M-segment sheet at 6048 x 4320 px: 47 s on a GPU
 * canvas (which then came back empty) vs 2.3 s on a CPU canvas. PDF.js's own
 * viewer makes the same choice (enableHWA is off by default). The finished
 * bitmap is copied once onto the visible canvas.
 */
export function createRasterCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
  return { canvas, ctx };
}

/**
 * Render into a detached canvas so a superseded PDF.js request never paints
 * over the active page.
 *
 * `renderKey`: when the visible canvas already holds this page, at this key
 * and bitmap size, only its CSS size changes. Past the bitmap cap every zoom
 * step has the same bitmap, so re-rasterising it would only cost time.
 * `renderParams`: extra page.render() parameters.
 * `onOperatorList`: receives the operator list of a real PDF.js render (not on reuse).
 * `rasterizer`: optional other engine ({ renderPagina }) tried first; null
 *   from it means PDF.js draws.
 * Returns true when the canvas shows the page, false when superseded.
 */
export async function renderPdfJsPageToCanvas({ page, viewport, canvas, dpr, optionalContentConfigPromise,
  isCurrent = () => true, maxAxisPx = PDFJS_MAX_BITMAP_AXIS_PX, renderKey = null, renderParams = null,
  onOperatorList = null, rasterizer = null }) {
  const k = pdfJsBitmapRatio(viewport.width, viewport.height, dpr, maxAxisPx);
  const width = Math.floor(viewport.width * k);
  const height = Math.floor(viewport.height * k);
  const cssWidth = Math.floor(viewport.width) + 'px';
  const cssHeight = Math.floor(viewport.height) + 'px';
  const held = canvas._pdfjsBitmap;
  if (renderKey != null && held && held.page === page && held.key === renderKey
      && canvas.width === width && canvas.height === height) {
    if (!isCurrent()) return false;
    canvas.style.width = cssWidth;
    canvas.style.height = cssHeight;
    return true;
  }
  // Een andere rasteraar (PDFium als WebAssembly, pdfium-web/) mag eerst;
  // levert die niets, dan tekent PDF.js.
  let rendered = rasterizer
    ? await rasterizer.renderPagina({ page, viewport, k, breedte: width, hoogte: height, renderParams })
    : null;
  if (!rendered) {
    const raster = createRasterCanvas(width, height);
    rendered = raster.canvas;
    const ctx = raster.ctx;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    const task = page.render({ canvasContext: ctx, canvas: rendered, viewport, annotationMode: 0,
      optionalContentConfigPromise, ...(renderParams || {}) });
    await task.promise;
    // De operatorlijst van deze render (zelfde parameters = zelfde lijst als
    // een latere detailrender): pdfjs-detail-layer.js bouwt er zijn index uit.
    try { onOperatorList?.(task._internalRenderTask?.operatorList || null); } catch { /* optioneel */ }
  }
  if (!isCurrent()) return false;
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  canvas.style.width = cssWidth;
  canvas.style.height = cssHeight;
  canvas.getContext('2d').drawImage(rendered, 0, 0);
  canvas._pdfjsBitmap = renderKey != null ? { page, key: renderKey } : null;
  return true;
}
