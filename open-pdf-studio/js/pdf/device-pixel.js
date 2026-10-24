// Device-pixel alignment for the single-page viewport.
//
// A PDFium bitmap or tile is a grid of device pixels. Drawn at a fractional
// device-pixel offset, the canvas resamples every pixel with its neighbour:
// a 1 px hairline becomes two half-grey pixels (about 20-30 % less contrast).
// The page bitmap and tiles stay pixel-exact when (1) the view offset is a
// whole number of device pixels and (2) a tile's region starts and ends on
// its own render grid. View rotation is always a quarter turn, so snapping
// the translation is enough.

/** Round a CSS-px offset to the nearest whole device pixel. */
export function snapNaarDevicePixel(waarde, dpr) {
  const r = dpr > 0 ? dpr : 1;
  if (!Number.isFinite(waarde)) return waarde;
  return Math.round(waarde * r) / r;
}

/**
 * Widen a page-space region (points) to whole pixels of the render grid at
 * `schaal` px/pt, so the tile's pixel (0,0) is exactly page point
 * (x·schaal, y·schaal) and its size is a whole number of pixels. Clamped to
 * the page.
 */
export function regioOpRenderRaster(regio, schaal, paginaW = Infinity, paginaH = Infinity) {
  if (!(schaal > 0)) return { ...regio };
  const x0 = Math.max(0, Math.floor(regio.x * schaal + 1e-6) / schaal);
  const y0 = Math.max(0, Math.floor(regio.y * schaal + 1e-6) / schaal);
  const maxX = Number.isFinite(paginaW) ? Math.ceil(paginaW * schaal - 1e-6) / schaal : Infinity;
  const maxY = Number.isFinite(paginaH) ? Math.ceil(paginaH * schaal - 1e-6) / schaal : Infinity;
  const x1 = Math.min(maxX, Math.ceil((regio.x + regio.w) * schaal - 1e-6) / schaal);
  const y1 = Math.min(maxY, Math.ceil((regio.y + regio.h) * schaal - 1e-6) / schaal);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/**
 * Resampling quality for drawing a bitmap rendered at `renderSchaal` px/pt
 * onto `doelSchaal` device px/pt. Downscaling with the default 'low' (2-tap
 * bilinear, no mipmaps) drops thin lines; 'high' keeps their coverage.
 */
export function tekenKwaliteit(renderSchaal, doelSchaal) {
  return renderSchaal > doelSchaal * 1.001 ? 'high' : null;
}

/**
 * Backing-store size of a canvas shown at cssW × cssH CSS px. Chromium (and
 * WebView2) report the exact device-pixel box through ResizeObserver
 * `devicePixelContentBoxSize`; at fractional scaling (125/150 %) the
 * compositor snaps the box to device pixels in a way round(css · dpr) does
 * not always match, and any mismatch makes it resample the whole canvas.
 * Use the reported box when it belongs to this CSS size, else round(css·dpr).
 */
export function backingMaat({ cssW, cssH, dpr, deviceBox = null }) {
  const r = dpr > 0 ? dpr : 1;
  if (deviceBox && deviceBox.w > 0 && deviceBox.h > 0
      && Math.abs(deviceBox.cssW - cssW) < 0.01 && Math.abs(deviceBox.cssH - cssH) < 0.01
      && Math.abs(deviceBox.w - cssW * r) <= 1 && Math.abs(deviceBox.h - cssH * r) <= 1) {
    return { w: deviceBox.w, h: deviceBox.h };
  }
  return { w: Math.round(cssW * r), h: Math.round(cssH * r) };
}

/**
 * PDFium render scale (px per pt) for one page in the continuous view: the
 * zoom times the dpr, so a HiDPI screen gets device pixels instead of a CSS-
 * resolution bitmap stretched by the compositor, but never more than `cap`
 * px on the page's longest side (`langsteZijdeCss` = CSS px at `schaal`).
 */
export function doorlopendeRenderSchaal(schaal, langsteZijdeCss, dpr, cap) {
  const r = dpr > 0 ? dpr : 1;
  if (!(langsteZijdeCss > 0)) return schaal * r;
  return Math.min(schaal * r, schaal * (cap / langsteZijdeCss));
}
