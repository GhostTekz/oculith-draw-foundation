// Markups List header count: the bottom dock shows the count in its header
// even while the list is collapsed. A measurement drawn with the dock closed
// must still update it (the hidden list skips building rows, #491, but not
// the count): after one Distance the header said "0 annotations" while the
// status bar said 1.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const store = await import('../../solid/stores/panels/annotationsStore.js');
const { countText, items } = store;
const { activeTab, setActiveTab, collapsed, setCollapsed, panelShown } = await import('../../solid/stores/leftPanelStore.js');
// The Markups List sits in the bottom panel host; collapsing that host hides it.
const hideList = () => { setActiveTab('annotations'); setCollapsed(true); };

// The list module with the real list store behind the bridge (the test hooks
// stub the whole bridge) and the canvas/navigation modules as no-ops; every
// other import is the real app module.
globalThis.__listBridge = {
  leftPanelCollapsed: collapsed, leftPanelActiveTab: activeTab,
  isPanelShown: panelShown, setLeftPanelCollapsed: setCollapsed,
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
    // Like Vite: './x.js' that only exists as './x.ts' is the .ts file.
    let target = new URL(spec, listUrl);
    if (!existsSync(target) && spec.endsWith('.js')) target = new URL(spec.replace(/\.js$/u, '.ts'), listUrl);
    return whole.replace(`'${spec}'`, `'${target.href}'`);
  });
const { updateAnnotationsList } = await import('data:text/javascript;base64,'
  + Buffer.from(listSource, 'utf8').toString('base64'));

function openDoc(annotations) {
  state.documents = [{ id: `dock-${Math.random()}`, currentPage: 1, viewMode: 'single',
    annotations, selectedAnnotations: [] }];
  state.activeDocumentIndex = 0;
}
const distance = (id) => ({ id, type: 'measureDistance', page: 1, startX: 0, startY: 0, endX: 72, endY: 0,
  measureText: '10\'-0"', createdAt: '2026-10-14T00:00:00Z' });

test('a collapsed Markups List still counts a new measurement', () => {
  hideList();
  openDoc([]);
  updateAnnotationsList();
  assert.equal(countText(), '0 annotations');
  state.documents[0].annotations.push(distance('m1'));
  updateAnnotationsList();
  assert.equal(countText(), '1 annotation', 'the dock header follows the new measurement');
  assert.equal(items().length, 0, 'the hidden list still does not build its rows');
});

test('the count matches the rows once the list is shown', () => {
  openDoc([distance('m1'), distance('m2'), { id: 'vp', type: 'scaleRegion', page: 1 }]);
  hideList();
  updateAnnotationsList();
  assert.equal(countText(), '2 annotations', 'named viewports are not markups');
  setActiveTab('annotations');
  if (collapsed()) setCollapsed(false);
  updateAnnotationsList();
  assert.equal(countText(), '2 annotations');
  assert.ok(items().length >= 2);
  assert.equal(activeTab(), 'annotations');
});
