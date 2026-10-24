// Keyboard model of the menu bar (MenuBar.jsx): pure functions over the
// visible items of one popup level, so the behaviour is unit tested.
//
// An item here is { kind: 'command' | 'submenu' | 'separator' | 'placeholder',
// enabled: boolean }. Only enabled commands and submenus take the highlight;
// separators, placeholders and disabled commands are skipped (as in the external editor).

export function isNavigable(item) {
  return !!item && (item.kind === 'command' || item.kind === 'submenu') && item.enabled !== false;
}

/** First (delta 1) or last (delta -1) navigable index, or -1. */
export function edgeIndex(items, delta = 1) {
  const n = items.length;
  for (let k = 0; k < n; k++) {
    const i = delta > 0 ? k : n - 1 - k;
    if (isNavigable(items[i])) return i;
  }
  return -1;
}

/** Next navigable index from `current` in direction `delta`, wrapping. */
export function nextIndex(items, current, delta) {
  const n = items.length;
  if (!n) return -1;
  if (current < 0 || current >= n) return edgeIndex(items, delta);
  for (let k = 1; k <= n; k++) {
    const i = (((current + delta * k) % n) + n) % n;
    if (isNavigable(items[i])) return i;
  }
  return -1;
}

/**
 * What a key does in an open menu.
 *   key      KeyboardEvent.key
 *   items    the items of the deepest open popup level
 *   index    highlighted index in that level (-1 for none)
 *   depth    0 = the top-level popup, 1+ = a submenu
 * Returns one of:
 *   { type: 'move', index }       highlight another item in this level
 *   { type: 'openSubmenu' }       open the highlighted submenu (focus its first item)
 *   { type: 'closeSubmenu' }      close this submenu, back to its parent item
 *   { type: 'switchMenu', delta } open the next/previous top-level menu
 *   { type: 'activate' }          run the highlighted command
 *   { type: 'close' }             close the menus
 *   null                          not a menu key
 */
export function menuKeyAction(key, items, index, depth) {
  const item = items[index];
  switch (key) {
    case 'ArrowDown': return { type: 'move', index: nextIndex(items, index, 1) };
    case 'ArrowUp': return { type: 'move', index: nextIndex(items, index, -1) };
    case 'Home': return { type: 'move', index: edgeIndex(items, 1) };
    case 'End': return { type: 'move', index: edgeIndex(items, -1) };
    case 'ArrowRight':
      return isNavigable(item) && item.kind === 'submenu' ? { type: 'openSubmenu' } : { type: 'switchMenu', delta: 1 };
    case 'ArrowLeft':
      return depth > 0 ? { type: 'closeSubmenu' } : { type: 'switchMenu', delta: -1 };
    case 'Enter':
    case ' ':
      if (!isNavigable(item)) return null;
      return item.kind === 'submenu' ? { type: 'openSubmenu' } : { type: 'activate' };
    case 'Escape':
      return depth > 0 ? { type: 'closeSubmenu' } : { type: 'close' };
    case 'Tab':
      return { type: 'close' };
    default:
      return null;
  }
}

/**
 * Keys while the menu bar has keyboard focus but no menu is open (after a
 * lone Alt press): arrows move along the titles, Enter/Down opens, a
 * mnemonic letter opens its menu, Escape or Alt leaves.
 */
export function barKeyAction(key, mnemonics, index) {
  const n = mnemonics.length;
  if (key === 'ArrowRight') return { type: 'move', index: (index + 1) % n };
  if (key === 'ArrowLeft') return { type: 'move', index: (index - 1 + n) % n };
  if (key === 'Enter' || key === ' ' || key === 'ArrowDown') return { type: 'open', index };
  if (key === 'Escape' || key === 'Alt') return { type: 'leave' };
  if (/^[a-z0-9]$/i.test(key)) {
    const i = mnemonics.indexOf(key.toUpperCase());
    return i >= 0 ? { type: 'open', index: i } : { type: 'leave' };
  }
  return { type: 'leave' };
}
