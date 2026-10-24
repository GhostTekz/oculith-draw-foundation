// Page raster canvases are created CPU-backed on WebKitGTK, where an
// accelerated 2D canvas is shown only as a compositor texture and a repaint
// around a text selection or a focused editor showed its white background.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { isWebKitGtk, pageCanvasContext, pageCanvasContextOptions } from './page-canvas-context.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

const UA = {
  tauriLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  epiphany: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  chromeLinux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  windowsWebview: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  macWebView: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

test('only WebKitGTK is detected', () => {
  assert.equal(isWebKitGtk(UA.tauriLinux), true);
  assert.equal(isWebKitGtk(UA.epiphany), true);
  for (const name of ['chromeLinux', 'windowsWebview', 'macWebView', 'android', 'firefox']) {
    assert.equal(isWebKitGtk(UA[name]), false, name);
  }
  assert.equal(isWebKitGtk(''), false);
});

test('the first getContext asks for a CPU canvas on WebKitGTK and the default elsewhere', () => {
  const calls = [];
  const canvas = { getContext: (type, options) => { calls.push([type, options]); return { type }; } };
  assert.ok(pageCanvasContext(canvas, UA.tauriLinux));
  assert.deepEqual(calls, [['2d', { willReadFrequently: true }]]);

  calls.length = 0;
  pageCanvasContext(canvas, UA.windowsWebview);
  assert.deepEqual(calls, [['2d', undefined]]);
  assert.equal(pageCanvasContextOptions(UA.macWebView), undefined);
  assert.equal(pageCanvasContext(null, UA.tauriLinux), null);
});

test('every page canvas gets its context here first', () => {
  // #pdf-canvas: initDomElements is its first getContext().
  assert.match(bron('../ui/dom-elements.js'), /pdfCtx = pageCanvasContext\(pdfCanvas\);/);
  assert.match(bron('./pdf-viewport.js'), /_ctx = pageCanvasContext\(canvas\);/);
  const renderer = bron('./renderer.js');
  assert.match(renderer, /pdfCanvasEl = document\.createElement\('canvas'\);\s*\/\/[^\n]*\n\s*pageCanvasContext\(pdfCanvasEl\);/);
  assert.match(bron('./continuous-native-detail-layer.js'),
    /this\.canvas = document\.createElement\('canvas'\);\s*pageCanvasContext\(this\.canvas\);/);
  assert.match(bron('./pdfjs-detail-layer.js'), /c = document\.createElement\('canvas'\);\s*pageCanvasContext\(c\);/);
});
