// The 'high' downscale of the page bitmap runs once per on-screen size
// instead of on every pan frame (scaled-page-copy.js).

import assert from 'node:assert/strict';
import test from 'node:test';

import { maakSchaalKopie } from './scaled-page-copy.js';

function opzet({ maxPixels } = {}) {
  const getekend = [];
  const canvassen = [];
  const kopie = maakSchaalKopie({
    maakCanvas: () => {
      const c = { width: 0, height: 0 };
      canvassen.push(c);
      return c;
    },
    context: (c) => ({
      set imageSmoothingQuality(q) { c.q = q; },
      set imageSmoothingEnabled(v) { c.aan = v; },
      drawImage: (bron, x, y, w, h) => getekend.push({ canvas: c, bron, x, y, w, h, q: c.q, aan: c.aan }),
    }),
    ...(maxPixels ? { maxPixels } : {}),
  });
  return { kopie, getekend, canvassen };
}

const bitmap = { width: 4000, height: 3000 };

test('a size seen for the first time is drawn directly', () => {
  const { kopie, getekend } = opzet();
  assert.equal(kopie.voor(bitmap, 1000.4, 750.2), null);
  assert.equal(getekend.length, 0);
});

test('a size that holds is filtered once, then reused while panning', () => {
  const { kopie, getekend, canvassen } = opzet();
  kopie.voor(bitmap, 1000, 750);
  const c = kopie.voor(bitmap, 1000, 750);
  assert.ok(c);
  assert.equal(c.width, 1000);
  assert.equal(c.height, 750);
  assert.deepEqual(getekend.map(({ x, y, w, h, q, aan }) => ({ x, y, w, h, q, aan })),
    [{ x: 0, y: 0, w: 1000, h: 750, q: 'high', aan: true }]);
  for (let i = 0; i < 30; i++) assert.equal(kopie.voor(bitmap, 1000, 750), c);
  assert.equal(getekend.length, 1, 'thirty pan frames, one filter pass');
  assert.equal(canvassen.length, 1);
});

test('a new zoom or a new bitmap draws directly until it holds, then refilters into the same canvas', () => {
  const { kopie, getekend, canvassen } = opzet();
  kopie.voor(bitmap, 1000, 750);
  kopie.voor(bitmap, 1000, 750);
  assert.equal(kopie.voor(bitmap, 1100, 825), null, 'zooming');
  assert.equal(kopie.voor(bitmap, 1200, 900), null, 'still zooming');
  const c = kopie.voor(bitmap, 1200, 900);
  assert.equal(c.width, 1200);
  const sharper = { width: 4096, height: 3072 };
  assert.equal(kopie.voor(sharper, 1200, 900), null, 'a new bitmap first draws directly');
  assert.equal(kopie.voor(sharper, 1200, 900), c);
  assert.equal(getekend.at(-1).bron, sharper);
  assert.equal(canvassen.length, 1, 'one canvas is reused');
});

test('too large or empty sizes are never copied, and wis() releases the copy', () => {
  const { kopie, canvassen } = opzet({ maxPixels: 100 * 100 });
  kopie.voor(bitmap, 200, 200);
  assert.equal(kopie.voor(bitmap, 200, 200), null);
  kopie.voor(bitmap, 0, 0);
  assert.equal(kopie.voor(bitmap, 0, 0), null);
  kopie.voor(bitmap, 50, 50);
  const c = kopie.voor(bitmap, 50, 50);
  assert.ok(c);
  kopie.wis();
  assert.equal(c.width, 0);
  assert.equal(kopie.voor(bitmap, 50, 50), null, 'after wis() the size must hold again');
  assert.equal(canvassen.length, 1);
});
