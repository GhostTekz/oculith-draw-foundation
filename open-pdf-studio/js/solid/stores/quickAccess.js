// Quick Access: the commands a user pins to the right end of the workflow
// toolbar (any registry command: from a toolbar button's context menu, the
// command palette, or the Quick Access menu). Kept in
// preferences.quickAccess; null means the default set.

import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';

export const DEFAULT_QUICK_ACCESS = Object.freeze(['file.open', 'file.save', 'edit.undo', 'edit.redo', 'file.print']);
export const MAX_QUICK_ACCESS = 16;

/** Normalise a stored list: unique non-empty strings, at most MAX (pure). */
export function normalizeQuickAccess(list) {
  if (!Array.isArray(list)) return [...DEFAULT_QUICK_ACCESS];
  const out = [];
  for (const id of list) {
    if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
    if (out.length === MAX_QUICK_ACCESS) break;
  }
  return out;
}

/** Pinned ids in order (reactive through state.preferences). */
export function quickAccessIds() {
  return normalizeQuickAccess(state.preferences?.quickAccess ?? null);
}

export const isPinned = (id) => quickAccessIds().includes(id);

function store(list) {
  if (!state.preferences) return;
  state.preferences.quickAccess = normalizeQuickAccess(list);
  savePreferences();
}

/** Pin a command (at the end); false when it is pinned already or the bar is full. */
export function pinCommand(id) {
  const ids = quickAccessIds();
  if (ids.includes(id) || ids.length >= MAX_QUICK_ACCESS) return false;
  store([...ids, id]);
  return true;
}

export function unpinCommand(id) {
  const ids = quickAccessIds();
  if (!ids.includes(id)) return false;
  store(ids.filter((x) => x !== id));
  return true;
}

export const togglePinned = (id) => (isPinned(id) ? unpinCommand(id) : pinCommand(id));

/** Move a pinned command one place left (-1) or right (+1). */
export function movePinned(id, delta) {
  const ids = quickAccessIds();
  const at = ids.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= ids.length) return false;
  ids.splice(at, 1);
  ids.splice(to, 0, id);
  store(ids);
  return true;
}

export function resetQuickAccess() {
  if (!state.preferences) return;
  state.preferences.quickAccess = null;
  savePreferences();
}
