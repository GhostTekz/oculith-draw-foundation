// Runs the Visual Search matcher (matcher.js) in a module Web Worker
// (visual-search-worker.js), one page raster per message, its pixels
// transferred rather than copied. Where workers are not available (node
// tests, an old webview) or the worker fails to start, the same functions
// run in place. cancelSearches() stops the worker (a running page search
// cannot be interrupted otherwise) and rejects what is pending.
//
// searchRaster({ width, height, rgba }, template, opts) → Promise<matches>
// (matcher.js searchImage: raster-pixel windows with score, rotation,
// scale and a grey thumbnail).

import { rgbaToInk, searchImage } from './matcher.js';

let worker = null;
let failed = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./visual-search-worker.js', import.meta.url), { type: 'module' });
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
    // A worker that cannot start or crashed: run in place from now on.
    failed = true;
    worker = null;
    const retry = [...pending.values()];
    pending.clear();
    for (const p of retry) p.retry();
  };
  return worker;
}

function plainOpts(opts = {}) {
  return {
    rotations: opts.rotations !== false,
    scaleStep: !!opts.scaleStep,
    floor: opts.floor,
    maxResults: opts.maxResults,
    thumbs: opts.thumbs !== false,
  };
}

function searchHere(raster, template, opts) {
  const image = { width: raster.width, height: raster.height, data: rgbaToInk(raster.rgba, raster.width, raster.height) };
  return searchImage(image, template, opts);
}

/**
 * @param {{ width:number, height:number, rgba:Uint8ClampedArray }} raster  a copy goes to the worker
 * @param {{ width:number, height:number, data:Float32Array }} template
 * @param {object} [opts]  matcher.js searchImage options
 */
export function searchRaster(raster, template, opts = {}) {
  const o = plainOpts(opts);
  const w = getWorker();
  const here = () => searchHere(raster, template, o);
  if (!w) return Promise.resolve().then(here);
  // The worker gets a copy (transferred), so a retry in place after a
  // worker crash still has the caller's pixels.
  const rgba = new Uint8ClampedArray(raster.rgba);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, retry: () => Promise.resolve().then(here).then(resolve, reject) });
    const t = { width: template.width, height: template.height, data: Float32Array.from(template.data) };
    w.postMessage({ op: 'search', id, width: raster.width, height: raster.height, rgba, template: t, opts: o },
      [rgba.buffer, t.data.buffer]);
  });
}

/** Stop the running search: terminate the worker and reject what is pending. */
export function cancelSearches() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  const all = [...pending.values()];
  pending.clear();
  for (const p of all) p.reject(Object.assign(new Error('Visual Search cancelled'), { cancelled: true }));
}

/** For tests: whether searches run in a worker. */
export const usesWorker = () => !!getWorker();
