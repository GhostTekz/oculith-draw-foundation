// Status-bar drawing aids: Snap to Content, Snap to Markup, Snap to Grid,
// Show Grid, Orthogonal (Shift constrains the angle) and Reuse (keep the tool
// active after placing a markup). Every toggle is an existing preference,
// persisted with the other preferences; this module only maps them.
//
// Content and Markup sit under the master `enableObjectSnap` switch of the
// Preferences dialog. A toggle shows "on" only when the master is on too;
// turning one on while the master is off turns the master on and leaves the
// other one off, so the status bar shows exactly what snaps.

import { state, getActiveDocument } from '../core/state.js';

export const SNAP_TOGGLES = [
  { id: 'content', shortcut: 'Ctrl+Shift+F8' },
  { id: 'markup', shortcut: 'Ctrl+Shift+F7' },
  { id: 'grid', pref: 'enableGridSnap', shortcut: 'Ctrl+Shift+F9' },
  { id: 'showGrid', pref: 'showGrid', shortcut: 'Shift+F9' },
  { id: 'ortho', pref: 'enableAngleSnap', shortcut: 'Shift' },
  { id: 'reuse', pref: 'keepToolActive', shortcut: null },
];

const OBJECT_SNAP_SUBS = { content: 'snapToPdfContent', markup: 'snapToMarkup' };

// Preferences whose default is "on" and that are read as `!== false`.
const DEFAULT_ON = new Set(['snapToMarkup', 'keepToolActive']);

function prefOn(prefs, key) {
  return DEFAULT_ON.has(key) ? prefs?.[key] !== false : !!prefs?.[key];
}

export function isSnapToggleOn(prefs, id) {
  const sub = OBJECT_SNAP_SUBS[id];
  if (sub) return !!prefs?.enableObjectSnap && prefOn(prefs, sub);
  const def = SNAP_TOGGLES.find(t => t.id === id);
  return def ? prefOn(prefs, def.pref) : false;
}

// The preference changes one click on toggle `id` makes (pure).
export function snapTogglePatch(prefs, id) {
  const on = isSnapToggleOn(prefs, id);
  const sub = OBJECT_SNAP_SUBS[id];
  if (sub) {
    if (on) return { [sub]: false };
    if (prefs?.enableObjectSnap) return { [sub]: true };
    const other = OBJECT_SNAP_SUBS[id === 'content' ? 'markup' : 'content'];
    return { enableObjectSnap: true, [sub]: true, [other]: false };
  }
  const def = SNAP_TOGGLES.find(t => t.id === id);
  return def ? { [def.pref]: !on } : {};
}

// plan-review function-key shortcuts for the toggles; null when `e` is not one.
export function snapToggleForKey(e) {
  if (!e || e.altKey) return null;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const shift = !!e.shiftKey;
  if (ctrl && shift) {
    if (e.key === 'F8') return 'content';
    if (e.key === 'F7') return 'markup';
    if (e.key === 'F9') return 'grid';
    return null;
  }
  if (shift && !ctrl && e.key === 'F9') return 'showGrid';
  return null;
}

// Apply a toggle to the live preferences, persist them and redraw (the grid
// overlay and snap indicator depend on these preferences).
export async function toggleSnapPreference(id) {
  const patch = snapTogglePatch(state.preferences, id);
  if (!Object.keys(patch).length) return;
  Object.assign(state.preferences, patch);
  state.lastSnapResult = null;
  try {
    const m = await import('../core/preferences.js');
    m.savePreferences?.();
  } catch (_) { /* preferences module unavailable (tests) */ }
  try {
    const r = await import('../annotations/rendering.js');
    if (getActiveDocument()?.viewMode === 'continuous') r.redrawContinuous();
    else r.redrawAnnotations();
  } catch (_) { /* no canvas (tests) */ }
}
