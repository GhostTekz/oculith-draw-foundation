// When a sidebar thumbnail may run, and when a miss must stay in the queue.
// A cancelled or still-running worker render leaves the row queued: it is
// still visible and has not been drawn.
//
// A miss must not be retried on the next tick (that spins), and it must not
// prevent the other visible rows from starting.

/** Wait before trying a deferred visible row again. */
export const THUMBNAIL_DEFER_MS = 500;

/**
 * Give up waiting on one render so the rest of the strip can paint.
 * The worker read itself may still be in flight: `WORKER_READ_TIMEOUT`
 * in `src-tauri/src/worker_pool/mod.rs` is 60s, and that worker holds its
 * request lock until the line arrives or that timer fires. This deadline
 * only frees the JS queue. A picture that lands later is still applied.
 */
export const THUMBNAIL_RENDER_TIMEOUT_MS = 8_000;

/** Defer hidden thumbnails except pages visible in the detached view. */
export function partitionThumbnailInvalidations(pageNums, panelShown, detachedRange) {
  if (panelShown) return { immediate: [...pageNums], deferred: [] };
  const immediate = [];
  const deferred = [];
  for (const pageNum of pageNums) {
    if (detachedRange && pageNum >= detachedRange.start && pageNum <= detachedRange.end) immediate.push(pageNum);
    else deferred.push(pageNum);
  }
  return { immediate, deferred };
}

/**
 * A picture has `dataURL`. `waiting` (type not in yet), `cancelled`
 * (the worker was told to stop), and `slow` (the JS deadline passed
 * while the render was still running) keep the page queued.
 */
export function thumbnailResultKeepsQueue(imageData) {
  return imageData?.deferred === 'waiting'
    || imageData?.deferred === 'cancelled'
    || imageData?.deferred === 'slow';
}

/**
 * Race one thumbnail render against `timeoutMs`.
 * `onTimeout` runs synchronously when the deadline wins, before the race
 * resolves, so the caller can mark the row in flight first.
 * `onLate` receives the real result if it arrives after that deadline.
 * A late rejection is swallowed: the race already settled.
 */
export function raceThumbnailRender(renderPromise, timeoutMs, onLate, onTimeout) {
  let timedOut = false;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (onTimeout) onTimeout();
      } finally {
        resolve({ deferred: 'slow' });
      }
    }, timeoutMs);
  });
  const deliverLate = (imageData) => {
    if (!timedOut || !onLate) return;
    try { onLate(imageData); } catch { /* the strip has already moved on */ }
  };
  const done = Promise.resolve(renderPromise).then(
    (imageData) => {
      clearTimeout(timer);
      deliverLate(imageData);
      return imageData;
    },
    (error) => {
      clearTimeout(timer);
      if (timedOut) {
        deliverLate(null);
        return null;
      }
      throw error;
    },
  );
  return Promise.race([done, timeout]);
}

/**
 * Visible-row queue. `pages` is the set the panel already mutates
 * (scroll adds the rows on screen). Holds and in-flight marks live here
 * so a cooled or still-running row is skipped without leaving the set.
 * `requestRun` / `finishPass` remember a start that arrived while a pass
 * was already inside `await`, which used to be dropped.
 */
export function createThumbnailCoordinator({
  deferMs = THUMBNAIL_DEFER_MS,
  now = () => Date.now(),
} = {}) {
  const pages = new Set();
  const holds = new Map();
  const inFlight = new Set();
  let running = false;
  let kicked = false;

  function cooling(page, t) {
    const hold = holds.get(page);
    return !!hold && hold.until > t;
  }

  return {
    pages,
    cooling(page) { return cooling(page, now()); },
    inFlight(page) { return inFlight.has(page); },
    markInFlight(page) { inFlight.add(page); },
    clearInFlight(page) { inFlight.delete(page); },
    forget(page) {
      holds.delete(page);
      inFlight.delete(page);
    },
    hold(page, reason) {
      pages.add(page);
      holds.set(page, { until: now() + deferMs, reason });
    },
    releaseTypeHolds() {
      for (const [page, hold] of holds) {
        if (hold.reason === 'type') holds.delete(page);
      }
    },
    pruneHolds() {
      for (const page of holds.keys()) {
        if (!pages.has(page)) holds.delete(page);
      }
    },
    reset() {
      pages.clear();
      holds.clear();
      inFlight.clear();
    },
    /**
     * Next visible page that may render.
     * Cached pages leave the set. A page that is in flight, still inside
     * its defer window, or `isBlocked` stays queued.
     * `status` is `ready`, `deferred` (something is waiting), or `idle`.
     */
    take({ isCached, isBlocked }) {
      const t = now();
      let sawWait = false;
      let chosen = null;
      for (const page of [...pages]) {
        if (isCached(page)) {
          pages.delete(page);
          holds.delete(page);
          inFlight.delete(page);
          continue;
        }
        if (chosen != null) continue;
        if (inFlight.has(page) || cooling(page, t)) {
          sawWait = true;
          continue;
        }
        if (isBlocked(page)) {
          holds.set(page, { until: t + deferMs, reason: 'type' });
          sawWait = true;
          continue;
        }
        chosen = page;
      }
      if (chosen == null) return { page: null, status: sawWait ? 'deferred' : 'idle' };
      pages.delete(chosen);
      holds.delete(chosen);
      return { page: chosen, status: 'ready' };
    },
    hasRunnable(isCached = () => false) {
      const t = now();
      for (const page of pages) {
        if (isCached(page) || inFlight.has(page) || cooling(page, t)) continue;
        return true;
      }
      return false;
    },
    /** @returns {boolean} true when the caller should schedule a pass. */
    requestRun() {
      if (running) {
        kicked = true;
        return false;
      }
      running = true;
      kicked = false;
      return true;
    },
    /**
     * The pass stopped. `again` means `requestRun` lost the race with
     * this pass and must be repeated.
     */
    finishPass() {
      running = false;
      if (kicked) {
        kicked = false;
        return 'again';
      }
      return 'idle';
    },
  };
}
