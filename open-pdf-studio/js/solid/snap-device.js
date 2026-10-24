// A CSS transform such as translate(-50%, -50%) draws the whole window on a
// fractional layer. On a fractional display scale that layer is blurry.
// These helpers move a window onto the device-pixel grid without a transform.

/** Round a CSS pixel onto the device-pixel grid. */
export function snapDevice(px) {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  return Math.round(px * dpr) / dpr;
}

/**
 * Shift a flex or flow box onto a device pixel. Clears a previous nudge
 * first, so it can run again after the window is resized.
 */
export function nudgeOntoDevicePixels(el) {
  if (!el) return;
  el.style.left = '';
  el.style.top = '';
  const rect = el.getBoundingClientRect();
  const dx = snapDevice(rect.left) - rect.left;
  const dy = snapDevice(rect.top) - rect.top;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.style.left = `${dx}px`;
  el.style.top = `${dy}px`;
}

/** Keep a fixed or absolute window where it is, on device pixels, with no transform. */
export function pinOntoDevicePixels(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  el.style.left = `${snapDevice(rect.left)}px`;
  el.style.top = `${snapDevice(rect.top)}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.marginLeft = '0';
  el.style.marginRight = '0';
  el.style.transform = 'none';
}
