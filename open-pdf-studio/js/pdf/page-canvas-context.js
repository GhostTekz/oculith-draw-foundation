// The 2D context of a canvas that shows the page raster: #pdf-canvas, the
// continuous-view page and sharp canvases, and the PDF.js detail canvas.
//
// On WebKitGTK 2.46 and later a GPU-accelerated 2D canvas is shown only as a
// compositor texture (CanvasAsLayerContents); ordinary painting skips it
// (HTMLCanvasElement::paint) and a repaint shows the element's own white
// background whenever the texture is not attached. A text selection, a
// focused editor or a layer-tree change around them is exactly such a
// repaint, so the drawing went white while text was selected or edited.
// WebKit bug 326792 fixes one way this goes wrong upstream; no WebKitGTK
// release carries it yet.
//
// willReadFrequently makes WebKit create the context unaccelerated: the
// canvas is then painted as ordinary content and has no texture to lose.
// The mode is fixed by the FIRST getContext() call on an element, so every
// page canvas asks here first. PDF.js rasterises on a CPU canvas for the
// same reason (pdfjs-canvas-render.js); the page canvas only receives
// finished bitmaps (drawImage/putImageData), which the CPU path handles well.
// The Chromium webview on Windows and the macOS webview keep their
// accelerated canvas.

/** Is this WebKitGTK (Linux WebKit, not Chromium)? */
export function isWebKitGtk(userAgent) {
  const ua = String(userAgent || '');
  return /AppleWebKit\//.test(ua)
    && /\bLinux\b/.test(ua)
    && !/\bAndroid\b/.test(ua)
    && !/\b(?:Chrome|Chromium|CriOS|Edg|EdgA|OPR)\//.test(ua);
}

function currentUserAgent() {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}

/** Options for the first getContext('2d') of a page canvas. */
export function pageCanvasContextOptions(userAgent = currentUserAgent()) {
  return isWebKitGtk(userAgent) ? { willReadFrequently: true } : undefined;
}

/** The 2D context of a page canvas, created CPU-backed on WebKitGTK. */
export function pageCanvasContext(canvas, userAgent = currentUserAgent()) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const options = pageCanvasContextOptions(userAgent);
  return (options && canvas.getContext('2d', options)) || canvas.getContext('2d');
}
