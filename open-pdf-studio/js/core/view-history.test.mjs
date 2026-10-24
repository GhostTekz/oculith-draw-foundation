// Previous / Next View (core/view-history.js): the pure stack (push, back,
// forward, truncation of the forward entries when a new view is visited,
// zoom-step coalescing) and the renderer hooks against a live document
// (the current entry is refreshed with the live view before a change, and
// restoring a view never records itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('./app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('./app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('./state.ts');
const vh = await import('./view-history.js');
const { createViewHistory, sameView, ZOOM_COALESCE_MS } = vh;

const v = (page, zoom = 1, x = 0, y = 0) => ({ page, zoom, x, y });

test('visit pushes views; back and forward walk them', () => {
  const h = createViewHistory();
  assert.equal(h.canBack(), false);
  h.visit(v(1));
  h.visit(v(2));
  h.visit(v(3));
  assert.deepEqual(h.entries.map((e) => e.page), [1, 2, 3]);
  assert.equal(h.canBack(), true);
  assert.equal(h.canForward(), false);
  assert.deepEqual(h.back(), v(2));
  assert.deepEqual(h.back(), v(1));
  assert.equal(h.back(), null, 'nothing before the first view');
  assert.equal(h.canForward(), true);
  assert.deepEqual(h.forward(), v(2));
  assert.deepEqual(h.forward(), v(3));
  assert.equal(h.forward(), null);
});

test('visiting after going back drops the forward branch', () => {
  const h = createViewHistory();
  [1, 2, 3, 4].forEach((p) => h.visit(v(p)));
  h.back();
  h.back();
  h.visit(v(7));
  assert.deepEqual(h.entries.map((e) => e.page), [1, 2, 7]);
  assert.equal(h.canForward(), false);
  assert.deepEqual(h.back(), v(2));
});

test('back and forward first store the live view of the entry they leave', () => {
  const h = createViewHistory();
  h.visit(v(1));
  h.visit(v(2));
  h.back(v(2, 2, 300, 40)); // panned and zoomed on page 2 before going back
  assert.deepEqual(h.forward(v(1, 1, 5, 5)), v(2, 2, 300, 40));
  assert.deepEqual(h.back(), v(1, 1, 5, 5));
});

test('the same view is not pushed twice; replace refreshes the current entry', () => {
  const h = createViewHistory();
  assert.equal(h.visit(v(1, 1.5, 10, 10)), true);
  assert.equal(h.visit(v(1, 1.5, 11, 10)), false, 'within 2 px is the same view');
  assert.equal(h.entries.length, 1);
  h.replace(v(1, 1.5, 200, 10));
  assert.deepEqual(h.current(), v(1, 1.5, 200, 10));
  assert.ok(sameView(v(3, 2, 0, 0), v(3, 2.0004, 1, 1)));
  assert.ok(!sameView(v(3, 2), v(4, 2)));
  assert.ok(!sameView(v(3, 2), v(3, 2.5)));
});

test('repeated zoom steps collapse into one entry; a page change does not', () => {
  const h = createViewHistory();
  h.visit(v(1, 1), { kind: 'page', now: 0 });
  h.visit(v(1, 1.25), { kind: 'zoom', now: 1000 });
  h.visit(v(1, 1.5), { kind: 'zoom', now: 1200 });
  h.visit(v(1, 2), { kind: 'zoom', now: 1400 });
  assert.deepEqual(h.entries.map((e) => e.zoom), [1, 2]);
  h.visit(v(1, 3), { kind: 'zoom', now: 1400 + ZOOM_COALESCE_MS + 1 });
  assert.deepEqual(h.entries.map((e) => e.zoom), [1, 2, 3], 'a later zoom is its own view');
  h.visit(v(2, 3), { kind: 'page', now: 5000 });
  h.visit(v(3, 3), { kind: 'page', now: 5001 });
  assert.equal(h.entries.length, 5);
});

test('zooming back to where a run of steps started leaves no empty step', () => {
  const h = createViewHistory();
  h.visit(v(1, 1), { kind: 'page', now: 0 });
  h.visit(v(1, 1.25), { kind: 'zoom', now: 1000 });
  h.visit(v(1, 1), { kind: 'zoom', now: 1100 });
  assert.deepEqual(h.entries.map((e) => e.zoom), [1]);
  assert.equal(h.canBack(), false);
});

test('the stack keeps at most `limit` views', () => {
  const h = createViewHistory({ limit: 3 });
  [1, 2, 3, 4, 5].forEach((p) => h.visit(v(p)));
  assert.deepEqual(h.entries.map((e) => e.page), [3, 4, 5]);
  assert.equal(h.index, 2);
});

test('renderer hooks record page changes from the live viewport', () => {
  window.__pdfViewport = { active: true, zoom: 1.5, offsetX: 0, offsetY: 0 };
  const doc = { pdfDoc: { numPages: 3 }, filePath: '/tmp/a.pdf', currentPage: 1, viewMode: 'single', scale: 1.5 };
  state.documents = [doc];
  state.activeDocumentIndex = 0;
  const live = state.documents[0];
  window.__pdfViewport.offsetX = 40; // the user panned before navigating
  vh.noteViewBefore(live);
  live.currentPage = 2;
  window.__pdfViewport.offsetX = 0;
  vh.noteViewAfter(live, 'page');
  const h = vh.historyFor(live);
  assert.deepEqual(h.entries.map((e) => [e.page, e.x]), [[1, 40], [2, 0]]);
  assert.equal(vh.canGoBackView(live), true);
  assert.equal(vh.canGoForwardView(live), false);
  assert.equal(vh.captureView(live).mode, 'viewport');
  // A document without a PDF records nothing.
  assert.equal(vh.captureView({ currentPage: 1 }), null);
});

test('goToPage and the zoom setters are wrapped by the hooks, restore is not recorded', () => {
  const src = readFileSync(new URL('../pdf/renderer.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ noteViewBefore, noteViewAfter \} from '\.\.\/core\/view-history\.js';/);
  assert.match(src, /const track = !options\.skipHistory && target !== doc\.currentPage;/);
  assert.match(src, /if \(track\) noteViewBefore\(doc\);\s*try \{\s*await _goToPageImpl\(pageNum, options\);/);
  for (const fn of ['zoomIn', 'zoomOut', 'fitWidth', 'fitPage', 'actualSize']) {
    assert.match(src, new RegExp(`export function ${fn}\\(\\) \\{ return _trackZoom\\(_${fn}\\); \\}`), fn);
  }
  assert.match(src, /export function setZoom\(newScale\) \{ return _trackZoom\(\(\) => _setZoom\(newScale\)\); \}/);
  const hist = readFileSync(new URL('./view-history.js', import.meta.url), 'utf8');
  assert.match(hist, /export function noteViewBefore[\s\S]*?if \(restoring \|\| !doc\?\.pdfDoc\) return;/);
  assert.match(hist, /export function noteViewAfter[\s\S]*?if \(restoring \|\| !doc\?\.pdfDoc\) return;/);
  assert.match(hist, /async function restoreView[\s\S]*?restoring\+\+;[\s\S]*?finally \{\s*restoring--;/);
});
