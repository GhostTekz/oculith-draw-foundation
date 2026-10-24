// Keyboard model of the menu bar (menuModel.js): which item the arrows
// reach, what Enter, Esc and the side arrows do at each level, and the
// keys while the bar has focus after a lone Alt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNavigable, edgeIndex, nextIndex, menuKeyAction, barKeyAction } from './menuModel.js';

const cmd = (enabled = true) => ({ kind: 'command', enabled });
const sub = (enabled = true) => ({ kind: 'submenu', enabled });
const SEP = { kind: 'separator' };
const PH = { kind: 'placeholder', enabled: false };

// 0 cmd, 1 sep, 2 disabled, 3 submenu, 4 placeholder, 5 cmd
const ITEMS = [cmd(), SEP, cmd(false), sub(), PH, cmd()];

test('only enabled commands and submenus take the highlight', () => {
  assert.deepEqual(ITEMS.map(isNavigable), [true, false, false, true, false, true]);
  assert.equal(edgeIndex(ITEMS, 1), 0);
  assert.equal(edgeIndex(ITEMS, -1), 5);
  assert.equal(edgeIndex([SEP, PH], 1), -1);
});

test('arrows skip separators, placeholders and disabled items, and wrap', () => {
  assert.equal(nextIndex(ITEMS, 0, 1), 3);
  assert.equal(nextIndex(ITEMS, 3, 1), 5);
  assert.equal(nextIndex(ITEMS, 5, 1), 0, 'wraps to the top');
  assert.equal(nextIndex(ITEMS, 0, -1), 5, 'wraps to the bottom');
  assert.equal(nextIndex(ITEMS, -1, 1), 0, 'nothing highlighted: Down takes the first');
  assert.equal(nextIndex(ITEMS, -1, -1), 5, 'nothing highlighted: Up takes the last');
  assert.equal(nextIndex([], -1, 1), -1);
});

test('menu keys at the top level and in a submenu', () => {
  assert.deepEqual(menuKeyAction('ArrowDown', ITEMS, 0, 0), { type: 'move', index: 3 });
  assert.deepEqual(menuKeyAction('End', ITEMS, 0, 0), { type: 'move', index: 5 });
  assert.deepEqual(menuKeyAction('Home', ITEMS, 5, 0), { type: 'move', index: 0 });
  // Right on a submenu opens it; elsewhere it moves to the next menu.
  assert.deepEqual(menuKeyAction('ArrowRight', ITEMS, 3, 0), { type: 'openSubmenu' });
  assert.deepEqual(menuKeyAction('ArrowRight', ITEMS, 0, 0), { type: 'switchMenu', delta: 1 });
  // Left closes a submenu, or moves to the previous menu at the top level.
  assert.deepEqual(menuKeyAction('ArrowLeft', ITEMS, 0, 1), { type: 'closeSubmenu' });
  assert.deepEqual(menuKeyAction('ArrowLeft', ITEMS, 0, 0), { type: 'switchMenu', delta: -1 });
  // Enter runs a command or opens a submenu; nothing on a disabled item.
  assert.deepEqual(menuKeyAction('Enter', ITEMS, 0, 0), { type: 'activate' });
  assert.deepEqual(menuKeyAction(' ', ITEMS, 3, 0), { type: 'openSubmenu' });
  assert.equal(menuKeyAction('Enter', ITEMS, 2, 0), null);
  assert.equal(menuKeyAction('Enter', ITEMS, -1, 0), null);
  // Esc closes one level at a time; Tab closes everything.
  assert.deepEqual(menuKeyAction('Escape', ITEMS, 0, 2), { type: 'closeSubmenu' });
  assert.deepEqual(menuKeyAction('Escape', ITEMS, 0, 0), { type: 'close' });
  assert.deepEqual(menuKeyAction('Tab', ITEMS, 0, 1), { type: 'close' });
  assert.equal(menuKeyAction('x', ITEMS, 0, 0), null);
});

test('keys while the bar has focus after a lone Alt press', () => {
  const m = ['O', 'F', 'E', 'V', 'D', 'B', 'T', 'W', 'H'];
  assert.deepEqual(barKeyAction('ArrowRight', m, 8), { type: 'move', index: 0 });
  assert.deepEqual(barKeyAction('ArrowLeft', m, 0), { type: 'move', index: 8 });
  assert.deepEqual(barKeyAction('Enter', m, 2), { type: 'open', index: 2 });
  assert.deepEqual(barKeyAction('ArrowDown', m, 4), { type: 'open', index: 4 });
  // A lone Alt, then T opens Tools (Alt+T itself is the Thumbnails panel).
  assert.deepEqual(barKeyAction('t', m, 0), { type: 'open', index: 6 });
  assert.deepEqual(barKeyAction('b', m, 0), { type: 'open', index: 5 });
  assert.deepEqual(barKeyAction('q', m, 0), { type: 'leave' });
  assert.deepEqual(barKeyAction('Escape', m, 3), { type: 'leave' });
  assert.deepEqual(barKeyAction('Alt', m, 3), { type: 'leave' });
});
