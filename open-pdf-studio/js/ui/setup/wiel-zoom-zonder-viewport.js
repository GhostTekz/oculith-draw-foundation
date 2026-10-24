// Ctrl+wheel zoom for a PDF that is not drawn by the vector viewport and not
// in continuous view (a single page in the browser build, a blank document).
// It used to swallow the wheel and do nothing for a PDF opened from a file
// (only blank documents zoomed, one full re-render per notch): the view
// looked frozen under the cursor. Here the wheel factor is gathered and
// applied as ONE re-render a short moment after the last notch (and at most
// every `maxWaitMs` while the wheel keeps turning), anchored so the point
// under the cursor stays put. Pure: the caller passes the scale getter and
// the apply function, so node tests drive it with a fake clock.

export const WHEEL_ZOOM_MIN = 0.05;
export const WHEEL_ZOOM_MAX = 24;

/** The scale after a wheel delta (negative deltaY = zoom in), clamped. */
export function scaleAfterWheel(scale, deltaY) {
  const next = scale * Math.pow(1.0015, -deltaY);
  return Math.min(WHEEL_ZOOM_MAX, Math.max(WHEEL_ZOOM_MIN, next));
}

/**
 * makeWheelZoom({ getScale, apply(newScale, anchor), setTimer, clearTimer,
 * now, delayMs, maxWaitMs }) → onWheel(deltaY, anchor). `apply` may be
 * async; while it runs, further notches gather for the next apply.
 */
export function makeWheelZoom({
  getScale, apply,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
  now = () => performance.now(), delayMs = 120, maxWaitMs = 300,
}) {
  let target = null;     // scale wanted by the notches so far
  let anchor = null;
  let timer = null;
  let firstAt = 0;
  let busy = false;

  async function flush() {
    timer = null;
    if (target == null) return;
    if (busy) { timer = setTimer(flush, delayMs); return; }
    const s = target, a = anchor;
    target = null;
    busy = true;
    try { await apply(s, a); } finally { busy = false; }
  }

  return function onWheel(deltaY, at) {
    if (!deltaY) return;
    const base = target ?? getScale();
    target = scaleAfterWheel(base, deltaY);
    anchor = at || anchor;
    const t = now();
    if (timer == null) firstAt = t;
    if (timer != null) clearTimer(timer);
    // Trailing apply, but never later than maxWaitMs after the first notch.
    const wait = Math.max(0, Math.min(delayMs, maxWaitMs - (t - firstAt)));
    timer = setTimer(flush, wait);
  };
}
