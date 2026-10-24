// Loads js/ui/panels/annotations-list.js under node with the real list store
// behind the bridge and the canvas/navigation modules as no-ops (the same
// approach as markups-dock-count.test.mjs). Register app-test-hooks and
// install the browser stubs before importing this file.
import { existsSync, readFileSync } from 'node:fs';

const store = await import('../../solid/stores/panels/annotationsStore.js');
const leftPanel = await import('../../solid/stores/leftPanelStore.js');

globalThis.__listBridge = {
  leftPanelCollapsed: leftPanel.collapsed, leftPanelActiveTab: leftPanel.activeTab,
  isPanelShown: leftPanel.panelShown, setLeftPanelCollapsed: leftPanel.setCollapsed,
  setAnnotationItems: store.setItems, setAnnotationCountText: store.setCountText,
  setAnnotationEmptyMessage: store.setEmptyMessage, annotationSortMode: store.sortMode,
  annotationColumnSort: store.columnSort, annotationFilterMode: store.filterMode,
  setAnnotationFilterMode: store.setFilterMode, annotationSearchQuery: store.searchQuery,
  isAnnotationStatusHidden: store.isStatusHidden, refreshAnnotationLayers: () => {},
};
const NOOP = ['./properties-panel.js', '../../pdf/renderer.js', '../../pdf/pdf-viewport.js',
  '../../pdf/wiel-scroll.js', '../../annotations/rendering.js', './left-panel.js'];
const listUrl = new URL('./annotations-list.js', import.meta.url);
const listSource = readFileSync(listUrl, 'utf8')
  .replace(/^import\s*\{([\s\S]*?)\}\s*from\s+'([^']+)';[ \t]*\r?$/gm, (whole, names, spec) => {
    const binding = names.split(',').map(n => n.trim()).filter(Boolean)
      .map(n => n.replace(/\s+as\s+/u, ': ')).join(', ');
    if (spec === '../../bridge.js') return `const { ${binding} } = globalThis.__listBridge;`;
    if (NOOP.includes(spec)) return `const { ${binding} } = new Proxy({}, { get: () => () => {} });`;
    let target = new URL(spec, listUrl);
    if (!existsSync(target) && spec.endsWith('.js')) target = new URL(spec.replace(/\.js$/u, '.ts'), listUrl);
    return whole.replace(`'${spec}'`, `'${target.href}'`);
  });

export const list = await import('data:text/javascript;base64,'
  + Buffer.from(listSource, 'utf8').toString('base64'));
export { store, leftPanel };

/** Show the Markups List so its rows are built (#491 skips a hidden list). */
export function showList() {
  leftPanel.setActiveTab('annotations');
  if (leftPanel.collapsed()) leftPanel.setCollapsed(false);
}
