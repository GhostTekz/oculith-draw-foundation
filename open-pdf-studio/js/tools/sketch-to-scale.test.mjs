// Sketch to Scale (the external editor): while a Distance, Perimeter/Polylength or Area is
// being drawn on a calibrated page, a typed length (decimal in the page unit
// or feet-inches) + Enter fixes the next segment along the cursor direction,
// Shift locks that direction to horizontal or vertical first, and the live
// readout shows the typed value. The real tool modules, keyed through the
// same capture module the keyboard handler uses.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { DEFAULT_PREFERENCES } = await import('../core/constants.js');
const measurement = await import('../annotations/measurement.js');
const { measureReadout, measureReadoutText, clearMeasureReadout } = await import('./measure-readout.js');
const { consumeKey, typedLengthMeasurement, exitTypeLengthMode, typeLengthFormat } = await import('./type-length-input.js');
const { parseCoordBuffer, parseFeetInchBuffer, lengteInEenheid } = await import('./coord-invoer.js');

// Same loader as measure-readout.test.mjs: the real tool source with the
// preview transform stubbed; every other import is the real app module.
function resolveSpec(spec, from) {
  const target = new URL(spec, from);
  if (!existsSync(target) && spec.endsWith('.js')) return new URL(spec.replace(/\.js$/, '.ts'), from).href;
  return target.href;
}
async function loadTool(rel) {
  const url = new URL(rel, import.meta.url);
  const src = readFileSync(url, 'utf8')
    .replace(/^import\s[\s\S]*?from\s+'([^']+)';[ \t]*\r?$/gm, (whole, spec) => (spec === '../tool-context.js'
      ? 'const applyToolTransform = () => {};'
      : whole.replace(`'${spec}'`, `'${resolveSpec(spec, url)}'`)));
  return import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
}
const { measureDistanceTool, measureAreaTool, measurePerimeterTool } = await loadTool('./tools/measurement-tool.js');

const canvasCtx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 0 })), set: (t, k, v) => { t[k] = v; return true; } });
function ctxAt(x, y) {
  return {
    x, y, state, canvasCtx, scale: 1,
    snap: () => ({ snapped: false }),
    redraw() {}, drawDimension() {}, drawSnapIndicator() {}, drawCentroidLabel() {},
    drawMeasureAreaShape() {}, drawMeasurePerimeterShape() {},
    snapAngle: (a, step) => Math.round(a / step) * step,
    calculateDistance: measurement.calculateDistance,
    calculateArea: measurement.calculateArea,
    calculatePerimeter: measurement.calculatePerimeter,
    formatMeasurement: measurement.formatMeasurement,
    snapDistanceTo10: measurement.snapDistanceTo10,
  };
}
const click = { button: 0, shiftKey: false, ctrlKey: false };
const move = { button: 0, shiftKey: false, ctrlKey: false };
const shiftMove = { ...move, shiftKey: true };

// 1/4" = 1'-0": 18 pt per foot.
const QUARTER = { pixelsPerUnit: 18, unit: 'ft' };

function openDoc(measureScale = null) {
  exitTypeLengthMode();
  state.preferences = { ...DEFAULT_PREFERENCES, measureScale: null, measureRounding: 'none', enableAngleSnap: true,
    angleSnapDegrees: 45 };
  state.documents = [{ id: `sketch-${Math.random()}`, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [], measureScale }];
  state.activeDocumentIndex = 0;
  state.dimPoints = [];
  state.isDrawingDimension = false;
  state.measurePoints = null;
  state.measurePhase = 'outer';
  state._typeLengthCommit = null;
  clearMeasureReadout();
}

/** Type like the keyboard handler: each key, then the preview at the cursor. */
function type(tool, text, cursor, ev = move) {
  for (const key of text) {
    assert.equal(consumeKey(key).handled, true, `key ${key}`);
    tool.onPointerMove(ctxAt(cursor.x, cursor.y), ev);
  }
}
function enter() {
  const r = consumeKey('Enter');
  if (r.committed) state._typeLengthCommit(r.length);
  return r;
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

test('feet-inch buffers', () => {
  assert.equal(parseFeetInchBuffer('10\''), 120);
  assert.equal(parseFeetInchBuffer('10\'6'), 126);
  assert.equal(parseFeetInchBuffer('10\'-6 1/2"'), 126.5);
  assert.equal(parseFeetInchBuffer('6 1/2"'), 6.5);
  assert.equal(parseFeetInchBuffer('6 1/2'), null, 'inches alone need their mark');
  assert.equal(parseFeetInchBuffer('10'), null, 'a bare number stays in the page unit');
  assert.deepEqual(parseCoordBuffer('12.5'), { kind: 'length', a: 12.5, b: null });
  near(lengteInEenheid(parseCoordBuffer('10\'-6"'), 'ft').a, 10.5, 'ft');
  near(lengteInEenheid(parseCoordBuffer('10\'-6"'), 'in').a, 126, 'in');
  near(lengteInEenheid(parseCoordBuffer('1\''), 'mm').a, 304.8, 'mm');
  assert.equal(lengteInEenheid(parseCoordBuffer('1\''), null).a, null, 'no length unit: no length');
});

test('Perimeter: a typed feet-inch length + Enter fixes the segment along the cursor', () => {
  openDoc(QUARTER);
  measurePerimeterTool.onPointerDown(ctxAt(100, 100), click);
  measurePerimeterTool.onPointerMove(ctxAt(150, 100), move); // direction: +x
  // The mouse wanders while typing; the direction stays locked.
  type(measurePerimeterTool, '10\'-6 1/2"', { x: 150, y: 160 });
  assert.equal(typeLengthFormat(), 'length');
  const readout = measureReadoutText(measureReadout(), measurement.formatMeasurement, 'Length',
    typedLengthMeasurement(), 'Typed');
  assert.equal(readout, 'Length: 10\'-6 1/2" · Typed: 10\'-6 1/2"');
  assert.equal(enter().committed, true);
  const p = state.measurePoints[1];
  near(p.x, 100 + 18 * (10 + 6.5 / 12), 'x'); near(p.y, 100, 'y');
  // Shift locks to the nearer axis. (50, 47) is horizontal, then 5' along it.
  measurePerimeterTool.onPointerMove(ctxAt(p.x + 50, p.y + 47), shiftMove);
  type(measurePerimeterTool, '5\'', { x: p.x + 50, y: p.y + 47 }, shiftMove);
  enter();
  const q = state.measurePoints[2];
  near(q.x, p.x + 90, 'axis x'); near(q.y, p.y, 'axis y');
  // A decimal in the page unit: 2.5 ft, straight down with Shift.
  measurePerimeterTool.onPointerMove(ctxAt(q.x + 3, q.y + 60), shiftMove);
  type(measurePerimeterTool, '2.5', { x: q.x + 3, y: q.y + 60 }, shiftMove);
  enter();
  const r = state.measurePoints[3];
  near(r.x, q.x, '90° x'); near(r.y, q.y + 45, '90° y');
});

test('Area and Distance take the same typed lengths', () => {
  openDoc(QUARTER);
  measureAreaTool.onPointerDown(ctxAt(0, 0), click);
  measureAreaTool.onPointerMove(ctxAt(0, -40), move); // up
  type(measureAreaTool, '4', { x: 0, y: -40 });
  enter();
  near(state.measurePoints[1].x, 0, 'area x'); near(state.measurePoints[1].y, -72, 'area y');

  openDoc(QUARTER);
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onPointerMove(ctxAt(0, 50), move);
  type(measureDistanceTool, '2\'', { x: 30, y: 50 });
  assert.equal(measureReadoutText(measureReadout(), measurement.formatMeasurement, 'Length'), 'Length: 2\'-0"');
  enter();
  near(state.dimPoints[1].x, 0, 'distance x'); near(state.dimPoints[1].y, 36, 'distance y');

  // Shift locks the leg horizontal or vertical. The keys arrive without
  // Shift (it cannot stay held for digits) and that axis stays. (50, 47)
  // is nearer horizontal.
  openDoc(QUARTER);
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onPointerMove(ctxAt(50, 47), shiftMove);
  type(measureDistanceTool, '5\'', { x: 50, y: 47 });
  enter();
  near(state.dimPoints[1].x, 90, 'ortho distance x');
  near(state.dimPoints[1].y, 0, 'ortho distance y');
});

test('an uncalibrated page does not take feet-inches as a length', () => {
  openDoc();
  measurePerimeterTool.onPointerDown(ctxAt(0, 0), click);
  measurePerimeterTool.onPointerMove(ctxAt(50, 0), move);
  type(measurePerimeterTool, '10\'', { x: 50, y: 0 });
  assert.equal(typedLengthMeasurement(), null);
  assert.equal(consumeKey('Enter').handled, false, 'Enter does not place a point');
  assert.equal(state.measurePoints.length, 1);
  // A plain number is still page points, and says so.
  for (let i = 0; i < 3; i++) consumeKey('Backspace');
  type(measurePerimeterTool, '72', { x: 50, y: 0 });
  assert.match(measurement.formatMeasurement(typedLengthMeasurement()), /^Scale not set · 72 pt$/u);
});

test('keys that do not fit are swallowed, not appended', () => {
  openDoc(QUARTER);
  measurePerimeterTool.onPointerDown(ctxAt(0, 0), click);
  assert.equal(consumeKey('\'').handled, false, 'a mark needs a number first');
  type(measurePerimeterTool, '1\'', { x: 10, y: 0 });
  consumeKey('\'');
  consumeKey('/');
  type(measurePerimeterTool, '-3 1/4"', { x: 10, y: 0 });
  near(typedLengthMeasurement().value, 1 + 3.25 / 12, 'buffer 1\'-3 1/4"');
});
