// How a shortcut is shown in tooltips, the command palette and the
// workflow toolbar: 'Ctrl+Shift+P' → ['Ctrl', 'Shift', 'P'] (on macOS
// ['⌘', '⇧', 'P']). The tables store Ctrl for Ctrl and Cmd alike.

const MAC_KEYS = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↩', Delete: '⌫' };

export const isMacPlatform = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '');

/** The keys of a shortcut as display parts (a '+' key stays one part). */
export function shortcutParts(shortcut, mac = isMacPlatform()) {
  if (!shortcut) return [];
  const parts = String(shortcut).split(/\+(?!$)/).filter(Boolean);
  return mac ? parts.map((p) => MAC_KEYS[p] || p) : parts;
}

/** One-line text: 'Ctrl+Shift+P' (or '⌘⇧P' on macOS). */
export function shortcutText(shortcut, mac = isMacPlatform()) {
  const parts = shortcutParts(shortcut, mac);
  return mac ? parts.join('') : parts.join('+');
}
