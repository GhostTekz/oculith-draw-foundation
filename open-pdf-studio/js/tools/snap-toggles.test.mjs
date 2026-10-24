// Status-bar drawing aids: each toggle maps to a persisted preference, the
// plan-review shortcuts pick the right toggle, and the snap engine honors
// Snap to Markup, Snap to Grid and the Shift (orthogonal) constraint.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { DEFAULT_PREFERENCES } = await import('../core/constants.js');
const toggles = await import('./snap-toggles.js');
const { performSnap } = await import('./snap-engine.js');
const { snapPointToGrid } = await import('../annotations/rendering/ui-state.js');
const { snapAngle } = await import('../utils/helpers.js');

const { SNAP_TOGGLES, isSnapToggleOn, snapTogglePatch, snapToggleForKey, toggleSnapPreference } = toggles;

function resetPrefs(extra = {}) {
  state.preferences = { ...DEFAULT_PREFERENCES, measureScale: null, ...extra };
  state.documents = [];
  state.activeDocumentIndex = -1;
}

const line = { id: 'l1', type: 'line', page: 1, startX: 100, startY: 100, endX: 200, endY: 100 };

test('every toggle reads an existing preference with its default', () => {
  resetPrefs();
  assert.deepEqual(SNAP_TOGGLES.map(t => t.id), ['content', 'markup', 'grid', 'showGrid', 'ortho', 'reuse']);
  for (const key of ['snapToPdfContent', 'snapToMarkup', 'enableGridSnap', 'showGrid', 'enableAngleSnap', 'keepToolActive', 'enableObjectSnap']) {
    assert.ok(key in DEFAULT_PREFERENCES, `${key} is a default preference`);
  }
  assert.equal(isSnapToggleOn(state.preferences, 'content'), true);
  assert.equal(isSnapToggleOn(state.preferences, 'markup'), true);
  assert.equal(isSnapToggleOn(state.preferences, 'grid'), false);
  assert.equal(isSnapToggleOn(state.preferences, 'showGrid'), false);
  assert.equal(isSnapToggleOn(state.preferences, 'ortho'), true);
  assert.equal(isSnapToggleOn(state.preferences, 'reuse'), true);
  // A preferences file from before snapToMarkup existed reads as "on".
  assert.equal(isSnapToggleOn({ enableObjectSnap: true }, 'markup'), true);
});

test('plain toggles flip their own preference', () => {
  resetPrefs();
  assert.deepEqual(snapTogglePatch(state.preferences, 'grid'), { enableGridSnap: true });
  assert.deepEqual(snapTogglePatch(state.preferences, 'showGrid'), { showGrid: true });
  assert.deepEqual(snapTogglePatch(state.preferences, 'ortho'), { enableAngleSnap: false });
  assert.deepEqual(snapTogglePatch(state.preferences, 'reuse'), { keepToolActive: false });
  assert.deepEqual(snapTogglePatch(state.preferences, 'content'), { snapToPdfContent: false });
  assert.deepEqual(snapTogglePatch(state.preferences, 'markup'), { snapToMarkup: false });
});

test('Content/Markup with object snap off: show off, turning one on leaves the other off', () => {
  const prefs = { ...DEFAULT_PREFERENCES, enableObjectSnap: false };
  assert.equal(isSnapToggleOn(prefs, 'content'), false);
  assert.equal(isSnapToggleOn(prefs, 'markup'), false);
  const patch = snapTogglePatch(prefs, 'content');
  assert.deepEqual(patch, { enableObjectSnap: true, snapToPdfContent: true, snapToMarkup: false });
  const after = { ...prefs, ...patch };
  assert.equal(isSnapToggleOn(after, 'content'), true);
  assert.equal(isSnapToggleOn(after, 'markup'), false, 'markup still shows what the user saw');
});

test('the external editor shortcuts: Ctrl+Shift+F8/F7/F9 and Shift+F9; plain F-keys are not toggles', () => {
  const k = (key, mods = {}) => snapToggleForKey({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  assert.equal(k('F8', { ctrlKey: true, shiftKey: true }), 'content');
  assert.equal(k('F7', { ctrlKey: true, shiftKey: true }), 'markup');
  assert.equal(k('F9', { ctrlKey: true, shiftKey: true }), 'grid');
  assert.equal(k('F9', { shiftKey: true }), 'showGrid');
  assert.equal(k('F9'), null, 'plain F9 stays the existing grid-snap key');
  assert.equal(k('F7'), null);
  assert.equal(k('F8', { shiftKey: true }), null);
  assert.equal(k('F9', { ctrlKey: true, shiftKey: true, altKey: true }), null);
  for (const t of SNAP_TOGGLES.filter(t => t.shortcut && t.shortcut.includes('F'))) {
    const parts = t.shortcut.split('+');
    const key = parts.pop();
    assert.equal(k(key, { ctrlKey: parts.includes('Ctrl'), shiftKey: parts.includes('Shift') }), t.id,
      `tooltip shortcut ${t.shortcut} is the key that toggles ${t.id}`);
  }
});

test('toggleSnapPreference changes the live preferences', async () => {
  resetPrefs();
  await toggleSnapPreference('markup');
  assert.equal(state.preferences.snapToMarkup, false);
  await toggleSnapPreference('grid');
  assert.equal(state.preferences.enableGridSnap, true);
  await toggleSnapPreference('grid');
  assert.equal(state.preferences.enableGridSnap, false);
});

test('Snap to Markup: annotation endpoints snap only while it is on', () => {
  resetPrefs({ snapToPdfContent: false });
  const on = performSnap(103, 102, [line], 1, 1);
  assert.equal(on.snapped, true);
  assert.deepEqual([on.x, on.y, on.type], [100, 100, 'endpoint']);

  state.preferences.snapToMarkup = false;
  const off = performSnap(103, 102, [line], 1, 1);
  assert.equal(off.snapped, false);
  assert.deepEqual([off.x, off.y], [103, 102]);

  // The vertex just placed is not a magnet: the next click would land on it
  // and the tool would throw that click away. An earlier vertex of the same
  // drawing still snaps, even when Snap to Markup is off.
  const alleen = performSnap(51, 49, [line], 1, 1, null, [{ x: 50, y: 50 }]);
  assert.equal(alleen.snapped, false);
  const eerder = performSnap(51, 49, [line], 1, 1, null, [{ x: 50, y: 50 }, { x: 80, y: 80 }]);
  assert.deepEqual([eerder.snapped, eerder.x, eerder.y], [true, 50, 50]);
});

test('Snap to Markup picks the nearest vertex of a polyline on the page only', () => {
  resetPrefs({ snapToPdfContent: false, snapToMidpoints: false });
  const poly = { id: 'p1', type: 'polyline', page: 1, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }] };
  const other = { id: 'p2', type: 'polyline', page: 2, points: [{ x: 38, y: 38 }, { x: 80, y: 80 }] };
  const snap = performSnap(37, 37, [poly, other], 1, 1);
  assert.deepEqual([snap.snapped, snap.x, snap.y], [true, 40, 40]);
  // The radius is in screen pixels: at 4x zoom 12 px is 3 page units.
  assert.equal(performSnap(36, 36, [poly], 1, 4).snapped, false);
});

test('Snap to Grid rounds to the grid spacing in drawing units', () => {
  resetPrefs({ enableGridSnap: true, gridSize: 10 });
  // Uncalibrated: one unit is one PDF point.
  assert.deepEqual(snapPointToGrid(23, 37), { x: 20, y: 40, snapped: true, type: 'grid' });
  assert.deepEqual(snapPointToGrid(4.9, 5), { x: 0, y: 10, snapped: true, type: 'grid' });
  // Calibrated in mm: 10 mm = 28.35 pt.
  state.documents = [{ id: 'g', currentPage: 1, annotations: [], measureScale: { pixelsPerUnit: 72 / 25.4, unit: 'mm' } }];
  state.activeDocumentIndex = 0;
  const g = snapPointToGrid(30, 50);
  assert.ok(Math.abs(g.x - 28.3465) < 1e-3 && Math.abs(g.y - 56.6929) < 1e-3, JSON.stringify(g));
  // Without object snap targets in reach, performSnap falls back to the grid.
  resetPrefs({ enableGridSnap: true, gridSize: 10, snapToPdfContent: false, snapToMarkup: false });
  const s = performSnap(103, 102, [line], 1, 1);
  assert.deepEqual([s.type, s.x, s.y], ['grid', 100, 100]);
  state.preferences.enableGridSnap = false;
  assert.equal(snapPointToGrid(23, 37), null);
});

test('Orthogonal: the Shift constraint rounds the angle to the snap step', () => {
  resetPrefs();
  const step = state.preferences.angleSnapDegrees;
  assert.equal(step, 45);
  assert.equal(snapAngle(7, step), 0);
  assert.equal(snapAngle(30, step), 45);
  assert.equal(snapAngle(80, step), 90);
  assert.equal(snapAngle(-100, step), -90);
  assert.equal(snapAngle(170, step), 180);
});
