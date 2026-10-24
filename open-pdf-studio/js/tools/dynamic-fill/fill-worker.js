// Web Worker for Dynamic Fill (see fill-engine.js): keeps each page's
// segments (sent once as a Float64Array) and runs findFillRegion /
// regionsInsideLoop on them. The gap-bridge cache in fill-region.js is keyed
// on the segments array, so it lives here too.

import { findFillRegion, regionsInsideLoop } from './fill-region.js';

const pages = new Map(); // key → segments
const escapes = new Map(); // key → { gap, test } of the last open paint flood

function strip(r) {
  const { escape, ...rest } = r;
  void escape;
  return rest;
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.op === 'edges') {
      const b = m.buf;
      const segs = new Array(b.length / 4);
      for (let i = 0; i < segs.length; i++) segs[i] = { x1: b[4 * i], y1: b[4 * i + 1], x2: b[4 * i + 2], y2: b[4 * i + 3] };
      pages.set(m.key, segs);
      // Keep the last few pages.
      while (pages.size > 6) {
        const first = pages.keys().next().value;
        pages.delete(first);
        escapes.delete(first);
      }
      return;
    }
    const segs = pages.get(m.key);
    if (!segs) throw new Error('page linework not loaded');
    if (m.op === 'fill') {
      const last = escapes.get(m.key);
      if (m.paint && last && last.gap === m.opts.gap && last.test(m.seed.x, m.seed.y)) {
        self.postMessage({ id: m.id, result: { status: 'open' } });
        return;
      }
      const r = findFillRegion(segs, m.seed, m.opts);
      if (r.status === 'open' && r.escape) escapes.set(m.key, { gap: m.opts.gap, test: r.escape });
      else escapes.delete(m.key);
      self.postMessage({ id: m.id, result: strip(r) });
    } else if (m.op === 'inside') {
      const regions = regionsInsideLoop(segs, m.loop, m.existing, m.opts).map(strip);
      self.postMessage({ id: m.id, result: regions });
    }
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err?.message || err) });
  }
};
