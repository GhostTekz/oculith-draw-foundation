// Leaving a measurement keeps a finishable shape and drops an incomplete one.
// Shift locks the next vertex to the nearer axis even when object snap is
// off that axis and angle snap is off.

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
const { exitTypeLengthMode } = await import('./type-length-input.js');
const {
  orthoFromLast, shouldCommitMeasurementOnLeave, dimensionOffset,
  queuedModifiers, heldModifiers, eventWithHeldModifiers,
} = await import('./measure-axis.js');

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
const click = { button: 0, shiftKey: false, ctrlKey: false };
const move = { button: 0, shiftKey: false, ctrlKey: false };
const shiftClick = { button: 0, shiftKey: true, ctrlKey: false };

function ctxAt(x, y, extra = {}) {
  return {
    x, y, state, canvasCtx, scale: 1,
    snap: () => ({ snapped: false }),
    redraw() {}, drawDimension() {}, drawSnapIndicator() {}, drawCentroidLabel() {},
    drawMeasureAreaShape() {}, drawMeasurePerimeterShape() {},
    snapAngle: (a, step) => Math.round(a / (step || 1)) * (step || 1),
    calculateDistance: measurement.calculateDistance,
    snapDistanceTo10: measurement.snapDistanceTo10,
    recordAdd() {},
    createMeasureAreaAnnotation(points) { return { type: 'measureArea', points: points.map((p) => ({ ...p })) }; },
    createMeasurePerimeterAnnotation(points) { return { type: 'measurePerimeter', points: points.map((p) => ({ ...p })) }; },
    ...extra,
  };
}

function openDoc() {
  exitTypeLengthMode();
  state.preferences = {
    ...DEFAULT_PREFERENCES,
    measureScale: null,
    measureRounding: 'none',
    enableAngleSnap: false,
    angleSnapDegrees: 15,
  };
  state.documents = [{
    id: `leave-${Math.random()}`, currentPage: 1, scale: 1, viewMode: 'single', annotations: [],
  }];
  state.activeDocumentIndex = 0;
  state.dimPoints = [];
  state.isDrawingDimension = false;
  state.measurePoints = null;
  state.measurePhase = 'outer';
  state.measureOuterPoints = null;
  state.measureHoles = [];
  state.lastSnapResult = null;
  state._typeLengthCommit = null;
}

const doc = () => state.documents[state.activeDocumentIndex];
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

test('two placed distance points commit on leave; one point cancels', () => {
  assert.equal(shouldCommitMeasurementOnLeave('measureDistance', 2), true);
  assert.equal(shouldCommitMeasurementOnLeave('measureDistance', 1), false);
  assert.equal(shouldCommitMeasurementOnLeave('measureArea', 3), true);
  assert.equal(shouldCommitMeasurementOnLeave('measureArea', 2), false);
  assert.equal(shouldCommitMeasurementOnLeave('measurePerimeter', 2), true);
  assert.equal(shouldCommitMeasurementOnLeave('measurePerimeter', 1), false);

  openDoc();
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onDeactivate(ctxAt(0, 0));
  assert.equal(doc().annotations.length, 0, 'one point is dropped');
  assert.equal(state.dimPoints.length, 0);

  openDoc();
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onEscape(ctxAt(0, 0));
  assert.equal(doc().annotations.length, 0, 'escape with one point cancels');

  openDoc();
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onPointerMove(ctxAt(100, 40), move);
  measureDistanceTool.onPointerDown(ctxAt(100, 0), click);
  assert.equal(state.dimPoints.length, 2);
  // setTool passes only state and redraw. Escape uses the same commit.
  const leave = { state, redraw() {}, recordAdd() {} };
  measureDistanceTool.onDeactivate(leave);
  assert.equal(doc().annotations.length, 1);
  const ann = doc().annotations[0];
  assert.equal(ann.type, 'measureDistance');
  assert.equal(ann.leaderStartX, 0);
  assert.equal(ann.leaderStartY, 0);
  assert.equal(ann.leaderEndX, 100);
  assert.equal(ann.leaderEndY, 0);
  near(ann.startY, 18, 'positive side');
  near(ann.endY, 18, 'positive side');
  near(ann.startX, 0, 'start x');
  near(ann.endX, 100, 'end x');
  const dist = measurement.calculateDistance(ann.startX, ann.startY, ann.endX, ann.endY, 1);
  assert.equal(ann.measureValue, dist.value);
  measureDistanceTool.onDeactivate(leave);
  measureDistanceTool.onEscape(ctxAt(0, 0));
  assert.equal(doc().annotations.length, 1, 'leaving again does not add a second dimension');

  openDoc();
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onPointerMove(ctxAt(80, -30), move);
  measureDistanceTool.onPointerDown(ctxAt(80, 0), click);
  measureDistanceTool.onDeactivate(leave);
  assert.equal(doc().annotations.length, 1);
  near(doc().annotations[0].startY, -18, 'cursor below the leg picks the other side');

  openDoc();
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onPointerDown(ctxAt(40, 0), click);
  measureDistanceTool.onPointerDown(ctxAt(40, 0), { button: 2, shiftKey: false, ctrlKey: false });
  assert.equal(doc().annotations.length, 0, 'right-click still cancels');
  assert.equal(state.dimPoints.length, 0);
});

test('area and perimeter finish on deactivate the same way Escape does', () => {
  openDoc();
  measureAreaTool.onPointerDown(ctxAt(0, 0), click);
  measureAreaTool.onPointerDown(ctxAt(30, 0), click);
  measureAreaTool.onDeactivate(ctxAt(0, 0));
  assert.equal(doc().annotations.length, 0, 'two area points cancel');

  openDoc();
  measureAreaTool.onPointerDown(ctxAt(0, 0), click);
  measureAreaTool.onPointerDown(ctxAt(30, 0), click);
  measureAreaTool.onPointerDown(ctxAt(30, 20), click);
  measureAreaTool.onDeactivate(ctxAt(0, 0));
  assert.equal(doc().annotations.length, 1);
  assert.equal(doc().annotations[0].type, 'measureArea');
  assert.equal(doc().annotations[0].points.length, 3);

  openDoc();
  measurePerimeterTool.onPointerDown(ctxAt(0, 0), click);
  measurePerimeterTool.onDeactivate(ctxAt(0, 0));
  assert.equal(doc().annotations.length, 0, 'one perimeter point cancels');

  openDoc();
  measurePerimeterTool.onPointerDown(ctxAt(0, 0), click);
  measurePerimeterTool.onPointerDown(ctxAt(25, 0), click);
  measurePerimeterTool.onDeactivate(ctxAt(0, 0));
  assert.equal(doc().annotations.length, 1);
  assert.equal(doc().annotations[0].type, 'measurePerimeter');
  assert.equal(doc().annotations[0].points.length, 2);
});

test('Shift on a diagonal cursor stays on axis when the snap point is off-axis', () => {
  const off = { snapped: true, x: 100, y: 5 };
  const cursor = { x: 30, y: 40 };
  const locked = orthoFromLast({ x: 0, y: 0 }, cursor, off);
  assert.equal(locked.x, 0);
  assert.equal(locked.y, 40);
  const onAxis = orthoFromLast({ x: 0, y: 0 }, { x: 40, y: 10 }, { snapped: true, x: 70, y: 0 });
  assert.equal(onAxis.x, 70);
  assert.equal(onAxis.y, 0);
  const side = dimensionOffset({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, 18);
  assert.equal(side.startY, 18);

  openDoc();
  const drawn = [];
  const ctx = ctxAt(30, 40, {
    snap: () => off,
    drawDimension(_c, dim) { drawn.push(dim); },
  });
  state.isDrawingDimension = true;
  state.dimPoints = [{ x: 0, y: 0 }];
  measureDistanceTool.onPointerMove(ctx, shiftClick);
  const preview = drawn.at(-1);
  assert.equal(preview.endX, 0);
  assert.equal(preview.endY, 40);
  assert.notEqual(preview.endX, off.x);

  openDoc();
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onPointerDown(ctxAt(30, 40, { snap: () => off }), shiftClick);
  assert.equal(state.dimPoints.length, 2);
  assert.equal(state.dimPoints[1].x, 0);
  assert.equal(state.dimPoints[1].y, 40);

  openDoc();
  measureDistanceTool.onPointerDown(ctxAt(0, 0), click);
  measureDistanceTool.onPointerDown(
    ctxAt(40, 10, { snap: () => ({ snapped: true, x: 70, y: 0 }) }),
    shiftClick,
  );
  assert.equal(state.dimPoints[1].x, 70);
  assert.equal(state.dimPoints[1].y, 0);
});

test('a coalesced pointer frame still sees Shift after the event drops it', () => {
  const ev = {
    shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
    clientX: 12, target: { id: 'canvas' },
    preventDefault() { this.prevented = true; },
  };
  const queued = queuedModifiers(ev);
  ev.shiftKey = false;
  const frame = eventWithHeldModifiers(ev, heldModifiers(queued, { shiftKey: false }));
  assert.equal(frame.shiftKey, true);
  assert.equal(frame.clientX, 12);
  frame.preventDefault();
  assert.equal(ev.prevented, true);

  const quiet = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, clientX: 3 };
  const live = eventWithHeldModifiers(quiet, heldModifiers(queuedModifiers(quiet), { shiftKey: true }));
  assert.equal(live.shiftKey, true);
  assert.equal(live.clientX, 3);
  const same = eventWithHeldModifiers(quiet, heldModifiers(queuedModifiers(quiet), { shiftKey: false }));
  assert.equal(same, quiet);
});
