// Runs the Dynamic Fill geometry (fill-region.js) off the main thread: a
// module Web Worker (fill-worker.js) gets each page's segments once and does
// the fills there, so even a dense sheet with a large gap tolerance never
// freezes the page. Where workers are not available (node tests, an old
// webview) the same functions run in place.
//
// fill(edges, seed, opts, paint) → Promise<findFillRegion result without the
// escape closure>. With paint = true an open flood is remembered and a later
// paint point inside it returns { status: 'open' } at once.
// inside(edges, loop, existing, opts) → Promise<regions>.

import { findFillRegion, regionsInsideLoop } from './fill-region.js';

let worker = null;
let failed = false;
let nextId = 1;
const pending = new Map();
const keys = new WeakMap(); // segments array → key in the worker

function getWorker() {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./fill-worker.js', import.meta.url), { type: 'module' });
  } catch {
    failed = true;
    return null;
  }
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
  };
  worker.onerror = () => {
    // A worker that cannot start or crashed: everything runs in place from now on.
    failed = true;
    worker = null;
    for (const p of pending.values()) p.retry();
    pending.clear();
  };
  return worker;
}

function keyFor(w, edges) {
  let key = keys.get(edges);
  if (key) return key;
  key = `p${nextId++}`;
  const buf = new Float64Array(edges.length * 4);
  edges.forEach((s, i) => { buf[4 * i] = s.x1; buf[4 * i + 1] = s.y1; buf[4 * i + 2] = s.x2; buf[4 * i + 3] = s.y2; });
  w.postMessage({ op: 'edges', key, buf }, [buf.buffer]);
  keys.set(edges, key);
  return key;
}

// In-place fallback, with the same paint memo the worker keeps.
let lastEscape = null;
function fillHere(edges, seed, opts, paint) {
  if (paint && lastEscape?.edges === edges && lastEscape.gap === opts.gap && lastEscape.test(seed.x, seed.y)) {
    return { status: 'open' };
  }
  const r = findFillRegion(edges, seed, opts);
  lastEscape = r.status === 'open' && r.escape ? { edges, gap: opts.gap, test: r.escape } : null;
  const { escape, ...rest } = r;
  void escape;
  return rest;
}

function call(msg, edges, here) {
  const w = getWorker();
  if (!w) return Promise.resolve().then(here);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, retry: () => Promise.resolve().then(here).then(resolve, reject) });
    w.postMessage({ ...msg, id, key: keyFor(w, edges) });
  });
}

const plainOpts = (opts) => ({
  gap: opts.gap || 0,
  boundaries: (opts.boundaries || []).map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
});

export function fill(edges, seed, opts = {}, paint = false) {
  const o = plainOpts(opts);
  return call({ op: 'fill', seed: { x: seed.x, y: seed.y }, opts: o, paint }, edges, () => fillHere(edges, seed, o, paint));
}

export function inside(edges, loop, existing = [], opts = {}) {
  const o = plainOpts(opts);
  const ex = existing.map((r) => ({ outer: r.outer, holes: r.holes }));
  return call({ op: 'inside', loop: loop.map((p) => ({ x: p.x, y: p.y })), existing: ex, opts: o }, edges,
    () => regionsInsideLoop(edges, loop, ex, o).map(({ escape, ...r }) => { void escape; return r; }));
}

/** For tests: whether fills run in a worker. */
export const usesWorker = () => !!getWorker();
