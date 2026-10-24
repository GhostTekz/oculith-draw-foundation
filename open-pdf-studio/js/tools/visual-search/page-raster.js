// Page rasters for Visual Search: the page as the user sees it (CropBox,
// /Rotate and any extra page rotation applied; markups left out), at a
// reduced scale, top-left origin. That is the annotation model space times
// `scale`, so a raster pixel (px, py) is the app point (px / scale, py / scale)
// and no further CropBox or rotation conversion is needed (see
// pdf/pdf-viewports.js naarAppRuimte for the user-space mapping).

/** Target side (px) of the picked symbol in the search raster. */
export const TEMPLATE_TARGET_PX = 32;
/** Smallest and largest search scale (raster px per PDF point). */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
/** Longest raster side. */
export const MAX_AXIS_PX = 4096;
/** Largest template side (px). */
export const MAX_TEMPLATE_PX = 72;

/**
 * Raster scale for a picked rectangle (app points) on pages of the given
 * size: the symbol's mean side lands near TEMPLATE_TARGET_PX, its long side
 * stays under MAX_TEMPLATE_PX and the page under MAX_AXIS_PX.
 * @param {{width:number,height:number}} rect
 * @param {{width:number,height:number}} page  largest page of the search
 */
export function searchScale(rect, page) {
  const mean = Math.sqrt(Math.max(1e-6, rect.width) * Math.max(1e-6, rect.height));
  let s = TEMPLATE_TARGET_PX / mean;
  s = Math.min(s, MAX_TEMPLATE_PX / Math.max(rect.width, rect.height));
  s = Math.min(s, MAX_AXIS_PX / Math.max(1, page.width, page.height));
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

/** pdf.js viewport rotation for a page plus the app's extra page rotation. */
export function viewRotation(page, extraRotation = 0) {
  return ((((page.rotate || 0) + (extraRotation || 0)) % 360) + 360) % 360;
}

/** App-space page size (points) of a pdf.js page. */
export function appPageSize(page, extraRotation = 0) {
  const vp = page.getViewport({ scale: 1, rotation: viewRotation(page, extraRotation) });
  return { width: vp.width, height: vp.height };
}

function defaultCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Render a pdf.js page (no annotations) on white at `scale`.
 * @param {any} page          pdf.js PDFPageProxy
 * @param {number} scale      raster px per point
 * @param {{ extraRotation?: number, createCanvas?: (w:number,h:number)=>any,
 *   optionalContentConfigPromise?: Promise<any> }} [opts]
 * @returns {Promise<{ width:number, height:number, rgba:Uint8ClampedArray, scale:number }>}
 */
export async function renderPageRaster(page, scale, opts = {}) {
  const viewport = page.getViewport({ scale, rotation: viewRotation(page, opts.extraRotation) });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = (opts.createCanvas || defaultCanvas)(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const params = { canvasContext: ctx, viewport, annotationMode: 0, canvas };
  if (opts.optionalContentConfigPromise) params.optionalContentConfigPromise = opts.optionalContentConfigPromise;
  await page.render(params).promise;
  const img = ctx.getImageData(0, 0, width, height);
  return { width, height, rgba: img.data, scale };
}
