// Instant zoom feedback (zoom-rek.js): stretching what is on screen keeps
// proportions, and the page point in the middle of the view stays there after
// the zoom (also when the render later replaces the stretched picture).

import assert from 'node:assert/strict';
import test from 'node:test';
import { rekHuidigBeeld, paginaPuntOnder, houdPuntVast } from './zoom-rek.js';

// A tiny DOM: a 1000×600 container at (0,0) scrolled by (scrollLeft, scrollTop),
// holding #pdf-canvas whose CSS size follows the zoom.
function dom({ scale, pageW = 2000, pageH = 1400 }) {
  const container = { clientWidth: 1000, clientHeight: 600, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) };
  const canvas = { style: { width: `${pageW * scale}px`, height: `${pageH * scale}px` },
    getBoundingClientRect: () => ({ left: -container.scrollLeft, top: -container.scrollTop,
      width: parseFloat(canvas.style.width), height: parseFloat(canvas.style.height) }) };
  globalThis.document = { getElementById: (id) => (id === 'pdf-container' ? container : id === 'pdf-canvas' ? canvas : null) };
  return { container, canvas };
}

test('stretching scales the CSS size and keeps proportions', () => {
  const { canvas } = dom({ scale: 0.5 });
  rekHuidigBeeld(1.5);
  assert.equal(canvas.style.width, '1500px');
  assert.equal(canvas.style.height, '1050px');
});

test('the page point in the middle of the view stays in the middle after a zoom', () => {
  const { container, canvas } = dom({ scale: 1 });
  container.scrollLeft = 300; container.scrollTop = 200;
  const p = paginaPuntOnder(null, 1);
  assert.deepEqual([p.px, p.py], [800, 500]); // middle 500,300 + scroll
  rekHuidigBeeld(2);           // instant stretch to scale 2
  houdPuntVast(p, 2);
  const na = paginaPuntOnder(null, 2);
  assert.deepEqual([na.px, na.py], [800, 500]);
  // The render replaces the stretched canvas with one of the same size: no jump.
  canvas.style.width = `${2000 * 2}px`; canvas.style.height = `${1400 * 2}px`;
  houdPuntVast(p, 2);
  assert.deepEqual([paginaPuntOnder(null, 2).px, paginaPuntOnder(null, 2).py], [800, 500]);
});
