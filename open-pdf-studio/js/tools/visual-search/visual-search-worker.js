// Web Worker for Visual Search (see search-engine.js): converts a page's
// RGBA raster to ink and runs the NCC search (matcher.js) off the main
// thread, so a whole-document search never freezes the UI.

import { rgbaToInk, searchImage } from './matcher.js';

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.op !== 'search') throw new Error(`unknown op ${m.op}`);
    const image = { width: m.width, height: m.height, data: rgbaToInk(m.rgba, m.width, m.height) };
    const matches = searchImage(image, m.template, m.opts);
    const transfer = matches.map((r) => r.thumb?.data?.buffer).filter(Boolean);
    self.postMessage({ id: m.id, result: matches }, transfer);
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err?.message || err) });
  }
};
