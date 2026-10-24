// Scale entry points in the app: the Calibrate pick opens Set Scale with
// the picked length, Esc/right-click cancel it, and every way of
// setting the document scale recalculates the existing measurements in one
// undo step without writing the old per-type DimScale preferences.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { applyPageScale, setScaleFromLine, showSetScaleDialog } = await import('./measurement.js');
const { invalidateScaleRegionCache } = await import('./scale-region.js');
const { ratioPixelsPerUnit } = await import('./scale-entry.js');
const { readFileSync } = await import('node:fs');

// The pick tool's module imports tools/manager.js and tool-context.js, which
// pull in the whole UI (dialogs as .jsx). Load the real tool source with
// setTool replaced by a recorder and the preview transform by a no-op; the
// other imports resolve to the real app modules.
const toolUrl = new URL('../tools/tools/calibration-pick-tool.js', import.meta.url);
const toolSource = readFileSync(toolUrl, 'utf8')
  .replace(/^import\s[\s\S]*?from\s+'([^']+)';[ \t]*\r?$/gm, (whole, spec) => (spec === '../manager.js'
    ? 'const setTool = (tool) => { globalThis.__toolSwitches.push(tool); };'
    : spec === '../tool-context.js'
      ? 'const applyToolTransform = () => {};'
      : whole.replace(`'${spec}'`, `'${new URL(spec, toolUrl).href}'`)));
globalThis.__toolSwitches = [];
const { calibrationPickTool } = await import('data:text/javascript;base64,'
  + Buffer.from(toolSource, 'utf8').toString('base64'));
const { getDialogs, closeDialog } = await import('../solid/stores/dialogStore.js');
const undoManager = await import('../core/undo-manager.js');

function openDocument({ measureScale = null, annotations = [], detectedScale = null } = {}) {
  state.documents = [{ id: `scale-entry-${Math.random()}`, currentPage: 1, scale: 1,
    viewMode: 'single', annotations, measureScale, detectedScale,
    undoStack: [], redoStack: [], savedUndoStackLength: 0 }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  state.calibrationPoints = [];
  globalThis.__toolSwitches = [];
  for (const d of getDialogs()) closeDialog(d.name);
  invalidateScaleRegionCache();
  return state.documents[0];
}

const distanceLine = () => ({ id: 'd1', type: 'measureDistance', page: 1,
  startX: 0, startY: 0, endX: 36, endY: 0 });

function pickCtx(x, y, pageNum = 1) {
  return { x, y, pageNum, state, scale: 1, redraw() {}, snap: () => ({ snapped: false }) };
}

test('Calibrate: two picks open Set Scale with the picked length', () => {
  openDocument();
  state.currentTool = 'calibrationPick';
  calibrationPickTool.onPointerDown(pickCtx(10, 10), { button: 0 });
  assert.equal(getDialogs().length, 0, 'one point does not open the dialog');
  calibrationPickTool.onPointerDown(pickCtx(40, 50), { button: 0 });
  const dialog = getDialogs().find(d => d.name === 'setScale');
  assert.ok(dialog, 'Set Scale opened');
  assert.equal(dialog.data.referencePixelLength, 50);
  assert.equal(dialog.data.pageNum, 1);
  assert.equal(state.calibrationPoints.length, 0);
  assert.deepEqual(globalThis.__toolSwitches, ['select']);
  assert.equal(getActiveDocumentScale(), null, 'picking alone sets no scale');
});

test('Calibrate: Esc and right-click cancel without a dialog or scale', () => {
  openDocument();
  calibrationPickTool.onPointerDown(pickCtx(10, 10), { button: 0 });
  assert.equal(calibrationPickTool.onEscape(pickCtx(0, 0)), true);
  assert.equal(state.calibrationPoints.length, 0);
  calibrationPickTool.onPointerDown(pickCtx(10, 10), { button: 0 });
  calibrationPickTool.onPointerDown(pickCtx(0, 0), { button: 2 });
  calibrationPickTool.onPointerDown(pickCtx(90, 10), { button: 0 });
  assert.equal(getDialogs().length, 0);
  assert.equal(getActiveDocumentScale(), null);
});

test('Calibrate: a second click on another page restarts the pick there', () => {
  openDocument();
  calibrationPickTool.onPointerDown(pickCtx(10, 10, 1), { button: 0 });
  calibrationPickTool.onPointerDown(pickCtx(40, 50, 2), { button: 0 });
  assert.equal(getDialogs().length, 0);
  calibrationPickTool.onPointerDown(pickCtx(40, 20, 2), { button: 0 });
  assert.equal(getDialogs()[0].data.referencePixelLength, 30);
  assert.equal(getDialogs()[0].data.pageNum, 2);
});

test('Set Scale opens prefilled only with an unconfirmed detected scale', () => {
  openDocument({ detectedScale: { ratio: 100, scaleText: '1:100' } });
  showSetScaleDialog();
  assert.deepEqual(getDialogs()[0], { name: 'setScale', data: { detectedRatio: 100, detectedImperial: false, pageNum: 1 } });
  openDocument({ detectedScale: { ratio: 100 }, measureScale: { pixelsPerUnit: 1, unit: 'mm' } });
  showSetScaleDialog();
  assert.equal(getDialogs()[0].data.detectedRatio, null);
});

test('applying a 1:48 ft scale recalculates existing measurements in one undo step', async () => {
  const doc = openDocument({ annotations: [distanceLine()] });
  assert.match(doc.annotations[0].measureText ?? 'Scale not set', /Scale not set|^$/u);
  const before = doc.undoStack.length;
  applyPageScale({ pixelsPerUnit: ratioPixelsPerUnit(48, 'ft'), unit: 'ft', method: 'ratio', scaleRatio: '1:48' });
  // 36 pt at 18 pt/ft = 2 ft.
  assert.equal(doc.annotations[0].measureValue, 2);
  assert.equal(doc.annotations[0].measureUnit, 'ft');
  assert.doesNotMatch(doc.annotations[0].measureText, /Scale not set/u);
  assert.equal(doc.undoStack.length, before + 1, 'one undo step');
  await undoManager.undo();
  assert.equal(doc.pageScales, null);
  assert.equal(doc.annotations[0].measureUnit, undefined);
});

test('Set scale from a line recalculates and leaves the DimScale preferences alone', () => {
  const doc = openDocument({ annotations: [distanceLine(),
    { id: 'd2', type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 0, endY: 72 }] });
  for (const p of ['measureDist', 'measureArea', 'measurePerim']) delete state.preferences[`${p}DimScale`];
  // The 36 pt line is 10'-6" = 10.5 ft.
  setScaleFromLine(36, 10.5, 'ft', doc.annotations[0]);
  assert.equal(doc.pageScales[1].unit, 'ft');
  assert.ok(Math.abs(doc.annotations[0].measureValue - 10.5) < 1e-9);
  assert.ok(Math.abs(doc.annotations[1].measureValue - 21) < 1e-9, 'other measurements follow');
  for (const p of ['measureDist', 'measureArea', 'measurePerim']) {
    assert.equal(state.preferences[`${p}DimScale`], undefined, `${p}DimScale untouched`);
  }
  setScaleFromLine(36, 5, 'yd', doc.annotations[0]);
  assert.equal(doc.pageScales[1].unit, 'ft', 'an unsupported unit cannot calibrate');
});

function getActiveDocumentScale() {
  const doc = state.documents[state.activeDocumentIndex];
  return doc?.measureScale ?? doc?.pageScales ?? null;
}
