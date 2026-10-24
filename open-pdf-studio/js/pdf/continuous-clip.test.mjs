// Scrolling in continuous view re-clips a page's markup canvas only when its
// clip no longer covers the visible part of the page (continuous-clip.js).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { clipDektZicht, clipUitDataset, zichtbaarPaginaDeel } from './continuous-clip.js';

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });

test('the visible part of a page in page-relative CSS px', () => {
  const container = rect(0, 100, 1000, 700);
  // Page 1200x1600 CSS px, scrolled so its top is 300 px above the container top.
  assert.deepEqual(zichtbaarPaginaDeel(container, rect(-100, -200, 1200, 1600), 1200, 1600), { l: 100, t: 300, r: 1100, b: 1000 });
  // A page container still at its old size: scaled to the new size.
  assert.deepEqual(zichtbaarPaginaDeel(container, rect(0, 100, 600, 800), 1200, 1600), { l: 0, t: 0, r: 1200, b: 1400 });
  assert.equal(zichtbaarPaginaDeel(container, rect(0, 900, 600, 800), 600, 800), null, 'below the view');
  assert.equal(zichtbaarPaginaDeel(container, rect(0, 0, 0, 0), 600, 800), null);
});

test('a clip with its margin covers a small scroll; a long scroll, a zoom or a dpr change does not', () => {
  const clip = { x: 0, y: 44, w: 1200, h: 1212, paginaW: 1200, paginaH: 1600, dpr: 2 };
  const zicht = { l: 100, t: 300, r: 1100, b: 1000 };
  assert.equal(clipDektZicht(clip, zicht, 1200, 1600, 2), true);
  assert.equal(clipDektZicht(clip, { ...zicht, t: 400, b: 1100 }, 1200, 1600, 2), true, '100 px further: still inside the margin');
  assert.equal(clipDektZicht(clip, { ...zicht, t: 600, b: 1300 }, 1200, 1600, 2), false, 'past the margin');
  assert.equal(clipDektZicht(clip, zicht, 1440, 1920, 2), false, 'zoomed');
  assert.equal(clipDektZicht(clip, zicht, 1200, 1600, 1), false, 'other dpr');
  assert.equal(clipDektZicht(clip, null, 1200, 1600, 2), false);
  assert.equal(clipDektZicht({ ...clip, w: NaN }, zicht, 1200, 1600, 2), false, 'a canvas from before this check is re-clipped');
});

test('the dataset round trip and the scroll wiring', () => {
  const ds = { clipX: '0', clipY: '44', clipW: '1200', clipH: '1212', clipPaginaW: '1200', clipPaginaH: '1600', backingScale: '2' };
  assert.deepEqual(clipUitDataset(ds), { x: 0, y: 44, w: 1200, h: 1212, paginaW: 1200, paginaH: 1600, dpr: 2 });

  const src = readFileSync(new URL('./renderer.js', import.meta.url), 'utf8');
  assert.match(src, /canvas\.dataset\.clipW = clipW;/);
  assert.match(src, /canvas\.dataset\.clipPaginaW = width;/);
  assert.match(src, /reclipAllContinuousAnnotationCanvases\(\{ alleenNodig: true \}\);/);
  // Zoom keeps the forced re-clip.
  assert.match(src, /reclipAllContinuousAnnotationCanvases\(\);/);
  // Reads before writes: the loop only collects, a second loop re-clips.
  const body = src.slice(src.indexOf('function reclipAllContinuousAnnotationCanvases'));
  const loop = body.slice(0, body.indexOf('\n}\n'));
  assert.match(loop, /werk\.push\(/);
  assert.match(loop, /for \(const \{ wrapper, pageNum, gelezen \} of werk\) reclipContinuousAnnotationCanvas/);
});
