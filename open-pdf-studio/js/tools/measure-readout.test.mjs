// Live measurement readout: while a measure tool places points it reports
// the current value (the same value as the on-canvas label), the status bar
// formats it with its unit or as "Scale not set", and it clears when the
// tool is not drawing.

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
const { measureReadout, setMeasureReadout, clearMeasureReadout, measureReadoutText } = await import('./measure-readout.js');

// The tool modules import tool-context.js, which pulls in the whole UI. Load
// their real source with the preview transform replaced by a no-op; every
// other import resolves to the real app module (same instances as above).
// Like Vite: './x.js' that only exists as './x.ts' is the .ts file.
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
const { measureAngleTool } = await loadTool('./tools/angle-tool.js');

const canvasCtx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 0 })), set: (t, k, v) => { t[k] = v; return true; } });

function ctxAt(x, y) {
  return {
    x, y, state, canvasCtx, scale: 1,
    snap: () => ({ snapped: false }),
    redraw() {}, drawDimension() {}, drawSnapIndicator() {}, drawCentroidLabel() {},
    drawMeasureAreaShape() {}, drawMeasurePerimeterShape() {},
    snapAngle: (a) => a,
    calculateDistance: measurement.calculateDistance,
    calculateArea: measurement.calculateArea,
    calculatePerimeter: measurement.calculatePerimeter,
    formatMeasurement: measurement.formatMeasurement,
    snapDistanceTo10: measurement.snapDistanceTo10,
  };
}
const move = { button: 0, shiftKey: false, ctrlKey: false };

function openDoc(measureScale = null) {
  state.preferences = { ...DEFAULT_PREFERENCES, measureScale: null, measureRounding: 'none' };
  state.documents = [{ id: `ro-${Math.random()}`, currentPage: 1, scale: 1, viewMode: 'single',
    annotations: [], measureScale }];
  state.activeDocumentIndex = 0;
  state.dimPoints = [];
  state.isDrawingDimension = false;
  state.measurePoints = null;
  state.measurePhase = 'outer';
  clearMeasureReadout();
}
const text = () => measureReadoutText(measureReadout(), measurement.formatMeasurement, 'Value');
const MM = { pixelsPerUnit: 72 / 25.4, unit: 'mm' };

test('readout text: unit when calibrated, "Scale not set" otherwise, degrees for angles', () => {
  openDoc();
  assert.equal(measureReadoutText(null, measurement.formatMeasurement), '');
  setMeasureReadout('length', { value: 72, unit: 'pt', calibrated: false });
  assert.equal(text(), 'Value: Scale not set · 72 pt');
  setMeasureReadout('length', { value: 2.5, unit: 'm', calibrated: true });
  assert.equal(text(), 'Value: 2.50 m');
  setMeasureReadout('angle', { value: 90, unit: '°' });
  assert.equal(text(), 'Value: 90.0 °');
  setMeasureReadout('area', { value: NaN, unit: 'm²' });
  assert.equal(measureReadout(), null, 'no number, no readout');
});

test('Measure Distance reports the rubber-band length and clears on hover', () => {
  openDoc();
  state.isDrawingDimension = true;
  state.dimPoints = [{ x: 0, y: 0 }];
  measureDistanceTool.onPointerMove(ctxAt(72, 0), move);
  assert.deepEqual(measureReadout(), { kind: 'length', value: 72, unit: 'pt', calibrated: false });
  assert.equal(text(), 'Value: Scale not set · 72 pt');

  openDoc(MM);
  state.isDrawingDimension = true;
  state.dimPoints = [{ x: 0, y: 0 }];
  measureDistanceTool.onPointerMove(ctxAt(0, 72), move);
  assert.equal(measureReadout().unit, 'mm');
  assert.equal(text(), 'Value: 25 mm');

  state.isDrawingDimension = false;
  state.dimPoints = [];
  measureDistanceTool.onPointerMove(ctxAt(10, 10), move);
  assert.equal(measureReadout(), null);
});

test('Measure Area reports the edge length, then the area; Perimeter the running length', () => {
  openDoc(MM);
  state.measurePoints = [{ x: 0, y: 0 }];
  measureAreaTool.onPointerMove(ctxAt(72, 0), move);
  assert.equal(measureReadout().kind, 'length');
  assert.equal(text(), 'Value: 25 mm');

  state.measurePoints = [{ x: 0, y: 0 }, { x: 72, y: 0 }];
  measureAreaTool.onPointerMove(ctxAt(72, 72), move);
  const r = measureReadout();
  assert.equal(r.kind, 'area');
  assert.equal(r.unit, 'mm²');
  assert.ok(Math.abs(r.value - 25.4 * 25.4 / 2) < 1e-6);
  assert.equal(text(), 'Value: 0.00 m²');

  openDoc();
  state.measurePoints = [{ x: 0, y: 0 }, { x: 30, y: 0 }];
  measurePerimeterTool.onPointerMove(ctxAt(30, 40), move);
  assert.deepEqual(measureReadout(), { kind: 'length', value: 70, unit: 'pt', calibrated: false });

  state.measurePoints = null;
  measurePerimeterTool.onPointerMove(ctxAt(5, 5), move);
  assert.equal(measureReadout(), null);
});

test('Measure Angle reports the angle once the vertex is placed', () => {
  openDoc();
  state.isDrawingDimension = true;
  state.dimPoints = [{ x: 100, y: 0 }];
  measureAngleTool.onPointerMove(ctxAt(0, 0), move);
  assert.equal(measureReadout(), null, 'first ray only: no angle yet');
  state.dimPoints = [{ x: 100, y: 0 }, { x: 0, y: 0 }];
  measureAngleTool.onPointerMove(ctxAt(0, 100), move);
  assert.equal(measureReadout().kind, 'angle');
  assert.equal(text(), 'Value: 90.0 °');
});
