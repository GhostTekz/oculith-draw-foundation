// Give the event loop a turn in the middle of long main-thread work, so a
// page bitmap that came back, a frame, input and IPC replies run before the
// work goes on. A MessageChannel message, not a timer: the web view stretches
// timers to a second while the window is out of view, and a chain of
// awaits on already-settled promises never leaves the current task at all.
// Node (unit tests, scripts) uses setImmediate.

let kanaal = null;
const wachtend = [];

function viaKanaal(resolve) {
  if (!kanaal) {
    kanaal = new MessageChannel();
    kanaal.port1.onmessage = () => { const verder = wachtend.shift(); if (verder) verder(); };
  }
  wachtend.push(resolve);
  kanaal.port2.postMessage(0);
}

/** Resolves in a later task of the event loop. */
export function yieldToMain() {
  return new Promise((resolve) => {
    if (typeof globalThis.setImmediate === 'function') globalThis.setImmediate(resolve);
    else if (typeof MessageChannel === 'function') viaKanaal(resolve);
    else setTimeout(resolve, 0);
  });
}

const nu = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * A slicer for a long loop: `await slice()` on every step yields once the
 * step has run `budgetMs` since the last yield (then resolves true).
 * `slice.yields` counts the yields.
 */
export function timeSlicer(budgetMs = 12) {
  let start = nu();
  const slice = async () => {
    if (nu() - start < budgetMs) return false;
    await yieldToMain();
    slice.yields++;
    start = nu();
    return true;
  };
  slice.yields = 0;
  return slice;
}

/**
 * After the next frame has been drawn (a frame callback, then a task), or at
 * once while the window is out of view and draws no frames.
 */
export function afterNextFrame() {
  if (typeof document === 'undefined' || document.hidden || typeof requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => requestAnimationFrame(() => { yieldToMain().then(resolve); }));
}
