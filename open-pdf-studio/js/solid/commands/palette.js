// Search behind Help > Find Tools + Commands (components/CommandPalette.jsx),
// kept free of JSX so it is unit tested.

import { searchCommands } from './registry.js';
import { menuPathOf } from './menus.js';

// Commands that need an argument (a style name, a preset id) are reachable
// from their menus, not runnable bare from the palette; the palette itself
// is not listed in the palette.
export const PALETTE_HIDDEN = new Set(['format.applyStyle', 'format.applyStylePreset', 'help.findCommands']);
export const PALETTE_LIMIT = 60;

/**
 * Ranked palette rows for a query: [{ cmd, path }], path = the translated
 * labels of the menus holding the command ('Document', or 'Edit', 'Arrange').
 */
export function paletteResults(query, t, limit = PALETTE_LIMIT) {
  return searchCommands(query, { t })
    .filter((cmd) => !PALETTE_HIDDEN.has(cmd.id))
    .slice(0, limit)
    .map((cmd) => ({ cmd, path: (menuPathOf(cmd.id) || []).map((key) => t(key)) }));
}
