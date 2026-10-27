// Window menu commands (the external editor Window menu, spec §1.4): Panels ▸ (one command
// per workspace panel), Hide Panels (Shift+F4), Auto-Hide Panel Access,
// Full Screen. The panel commands drive the panel hosts through
// components/panels/panelActions.js (the same actions as the access bars),
// so Window ▸ Panels, the Alt panel keys and the access bars agree.

import { registerCommand } from './registry.js';
import { lucide } from '../data/lucideIcons.js';
import { fullscreenIcon, navigationIcon } from '../data/ribbonIcons.js';
import { PANEL_IDS, HOSTS, workspaceLayout, getHost, setAutoHidePanelAccess } from '../stores/workspaceLayout.js';
import { panelShown } from '../stores/leftPanelStore.js';
import { isFullscreen } from '../stores/ribbonStore.js';
import { activatePanel, togglePanel as togglePanelHost, hideAllPanels, toggleHost } from '../components/panels/panelActions.js';
import { PANEL_ORDER, getPanelEntry } from '../components/panels/panelRegistry.js';
import { lazyModule } from './util.js';

const C = 'window';
// symbolStore pulls in the symbol libraries (Vite globs), so it loads lazily.
const symbolStore = lazyModule(() => import('../stores/symbolStore.js'));
const toolChestFloating = () => symbolStore()?.symbolPaletteMode() === 'float';

// --- Panels --------------------------------------------------------------------

// Markup layers live in the one Layers panel (markup layers above the PDF
// layers), so Window ▸ Panels ▸ Markup Layers opens and reads that tab.
const SHOWN_AS = { annotationLayers: 'layers' };
const OPENERS = {
  annotationLayers: () => import('../stores/annotationLayersStore.js').then((m) => m.showAnnotationLayersPanel()),
};

/** Is the panel on screen: the active tab of an expanded host (or the floating Tool Chest). */
export function isPanelOpen(panelId) {
  if (panelId === 'toolChest' && toolChestFloating()) return !!symbolStore()?.symbolPaletteVisible();
  return panelShown(SHOWN_AS[panelId] || panelId);
}

/** Show a panel (activate it in its host and expand the host). */
export function revealPanel(panelId) {
  if (panelId === 'toolChest' && toolChestFloating()) {
    if (!symbolStore()?.symbolPaletteVisible()) return import('../components/SymbolPalette.jsx').then((m) => m.toggleSymbolPalette());
    return undefined;
  }
  if (OPENERS[panelId]) return OPENERS[panelId]();
  if (panelId === 'properties' && !isPanelOpen(panelId)) {
    // Fills the panel with the selection (or the document info) as it opens.
    return import('../../ui/panels/properties-panel.js').then((m) => m.togglePropertiesPanel());
  }
  return activatePanel(panelId);
}

/**
 * Toggle a panel: open → collapse its host (the tab stays in its access bar,
 * like clicking the active access-bar icon); closed or hidden → show it.
 */
export function togglePanel(panelId) {
  if (panelId === 'toolChest' && toolChestFloating()) {
    return import('../components/SymbolPalette.jsx').then((m) => m.toggleSymbolPalette());
  }
  if (!isPanelOpen(panelId)) return revealPanel(panelId);
  return togglePanelHost(SHOWN_AS[panelId] || panelId);
}

// the external editor panel shortcuts (spec §1.11), as the panel registry lists them. Alt+B
// and Alt+T are also the Batch and Tools menu mnemonics; the panels win, see
// shortcut-table.js.
export const PANEL_SHORTCUTS = Object.freeze(Object.fromEntries(
  PANEL_ORDER.map((id) => [id, getPanelEntry(id)?.shortcut]).filter(([, key]) => key),
));

for (const panelId of PANEL_IDS) {
  registerCommand({
    id: `window.panel.${panelId}`, label: getPanelEntry(panelId)?.commandLabel || `common:commands.panels.${panelId}`, icon: getPanelEntry(panelId)?.icon || null,
    shortcut: PANEL_SHORTCUTS[panelId] || null, category: C, keywords: ['panel', 'show', 'hide'],
    checked: () => isPanelOpen(panelId),
    // runCommand(id, { reveal: true }) only opens (the old ribbon buttons).
    run: (opts) => (opts?.reveal ? revealPanel(panelId) : togglePanel(panelId)),
  });
}

registerCommand({
  // The left panel host as a whole (the old navigation panel button).
  id: 'window.leftPanel', label: 'common:commands.leftPanel', icon: navigationIcon, shortcut: 'Ctrl+B', category: C,
  checked: () => { const h = getHost('left'); return !!h && h.tabs.length > 0 && !h.collapsed; },
  keywords: ['navigation', 'side panel'],
  run: () => toggleHost('left'),
});

const anyHostOpen = () => HOSTS.some((h) => {
  const host = getHost(h);
  return host && host.tabs.length > 0 && !host.collapsed;
});

registerCommand({
  // the external editor Hide Panels: collapse every panel host; again to bring them back.
  id: 'window.hidePanels', label: 'common:commands.hidePanels', icon: lucide('panel-left'), shortcut: 'Shift+F4',
  category: C, keywords: ['panels', 'maximize', 'canvas'],
  checked: () => !anyHostOpen(),
  run: () => hideAllPanels(),
});
registerCommand({
  id: 'window.autoHidePanelAccess', label: 'common:commands.autoHidePanelAccess', icon: null, category: C,
  checked: () => !!workspaceLayout().autoHidePanelAccess, keywords: ['access bar', 'auto hide'],
  run: () => setAutoHidePanelAccess(!workspaceLayout().autoHidePanelAccess),
});
registerCommand({
  // the external editor: F11. Here F11 is still the Markups list and Ctrl+L full screen
  // (shortcut-table.js).
  id: 'window.fullScreen', label: 'common:commands.fullScreen', icon: fullscreenIcon, shortcut: 'Ctrl+L', category: C,
  checked: () => isFullscreen(), keywords: ['fullscreen', 'maximize'],
  run: () => import('../../ui/chrome/fullscreen.js').then((m) => m.toggleFullscreen()),
});
