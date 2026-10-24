// Instant zoom feedback without the vector viewport (browser build, single
// page): stretch what is on screen now to the new zoom (CSS only, the pixels
// stay) and keep a page point fixed, so a zoom shows at once; the render that
// follows replaces it with sharp pixels. On a heavy sheet that render takes
// over a second, and without this the screen stood still on the old zoom and
// then jumped.

/**
 * Stretch #pdf-canvas, the sharp detail cut-out and the overlay canvases by
 * factor `f` (CSS only). Proportions stay, so nothing distorts.
 */
export function rekHuidigBeeld(f) {
  if (typeof document === 'undefined' || !(f > 0) || f === 1) return;
  for (const id of ['pdf-canvas', 'annotation-canvas', 'text-highlight-canvas']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const w = parseFloat(el.style.width), h = parseFloat(el.style.height);
    if (w > 0 && h > 0) { el.style.width = `${w * f}px`; el.style.height = `${h * f}px`; }
    // Overlay cut-out at deep zoom: its position scales too.
    for (const k of ['left', 'top']) {
      const v = parseFloat(el.style[k]);
      if (v) el.style[k] = `${v * f}px`;
    }
  }
  const detail = document.getElementById('pdf-detail-canvas');
  if (detail && detail.style.display !== 'none') {
    for (const k of ['left', 'top', 'width', 'height']) {
      const v = parseFloat(detail.style[k]);
      if (Number.isFinite(v)) detail.style[k] = `${v * f}px`;
    }
  }
}

/**
 * The page point (CSS px at scale 1) under client point `at`, or under the
 * middle of #pdf-container when `at` is not given.
 */
export function paginaPuntOnder(at, scale) {
  const container = document.getElementById('pdf-container');
  const canvas = document.getElementById('pdf-canvas');
  const r = canvas?.getBoundingClientRect();
  if (!container || !r || !(scale > 0)) return null;
  const c = container.getBoundingClientRect();
  const x = at ? at.clientX : c.left + container.clientWidth / 2;
  const y = at ? at.clientY : c.top + container.clientHeight / 2;
  return { px: (x - r.left) / scale, py: (y - r.top) / scale, clientX: x, clientY: y };
}

/** Scroll so page point `p` (from paginaPuntOnder) sits under its client point again. */
export function houdPuntVast(p, scale) {
  const container = document.getElementById('pdf-container');
  const r = document.getElementById('pdf-canvas')?.getBoundingClientRect();
  if (!container || !r || !p) return;
  container.scrollLeft += (r.left + p.px * scale) - p.clientX;
  container.scrollTop += (r.top + p.py * scale) - p.clientY;
}
