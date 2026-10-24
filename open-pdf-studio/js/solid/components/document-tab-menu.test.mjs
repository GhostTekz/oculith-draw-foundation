// Document tabs (the external editor workspace WP4): the tab menu, close/cycle helpers and
// the tab strip wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { docTabMenuItems, tabsToClose, cycleTabIndex, tabLabel } from './document-tab-menu.js';

const lees = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ids = (items) => items.map((i) => (i ? i.id : '|'));

test('tab menu: Close / Close All / Close Others | splits | Properties, in the external editor order', () => {
  const web = docTabMenuItems({ index: 0, count: 3 });
  assert.deepEqual(ids(web), ['close', 'closeAll', 'closeOthers', '|', 'splitVertical', 'splitHorizontal', 'switch', '|', 'properties']);
  const desktop = docTabMenuItems({ index: 1, count: 3, desktop: true, canReveal: true });
  assert.deepEqual(ids(desktop), ['close', 'closeAll', 'closeOthers', '|', 'splitVertical', 'splitHorizontal', 'switch',
    'detach', '|', 'showInFolder', '|', 'properties']);
  assert.equal(desktop.at(-1).id, 'properties', 'Properties last');
  // Show in folder needs the desktop shell and a file on disk.
  assert.ok(!ids(docTabMenuItems({ index: 0, count: 1, desktop: true, canReveal: false })).includes('showInFolder'));
  assert.ok(!ids(docTabMenuItems({ index: 0, count: 1, desktop: false, canReveal: true })).includes('showInFolder'));
});

test('tab menu: splits need a tab, Switch needs a split view; Close Others needs two tabs', () => {
  const byId = (items) => Object.fromEntries(items.filter(Boolean).map((i) => [i.id, i]));
  const now = byId(docTabMenuItems({ index: 0, count: 1 }));
  assert.equal(now.splitVertical.disabled, false);
  assert.equal(now.splitHorizontal.disabled, false);
  assert.equal(now.splitVertical.shortcut, 'Ctrl+Alt+2');
  assert.equal(now.splitHorizontal.shortcut, 'Ctrl+H');
  assert.equal(now.switch.disabled, true, 'Switch moves a tab to the other split');
  assert.equal(now.closeOthers.disabled, true);
  assert.equal(now.close.disabled, false);
  assert.equal(now.close.shortcut, 'Ctrl+W');
  const none = byId(docTabMenuItems({ index: -1, count: 0 }));
  for (const id of ['splitVertical', 'splitHorizontal', 'switch']) assert.equal(none[id].disabled, true, id);
  const split = byId(docTabMenuItems({ index: 0, count: 2, split: true }));
  for (const id of ['splitVertical', 'splitHorizontal', 'switch', 'closeOthers']) assert.equal(split[id].disabled, false, id);
});

test('close actions close the right tabs, highest index first', () => {
  assert.deepEqual(tabsToClose('close', 1, 3), [1]);
  assert.deepEqual(tabsToClose('closeAll', 1, 3), [2, 1, 0]);
  assert.deepEqual(tabsToClose('closeOthers', 1, 3), [2, 0]);
  assert.deepEqual(tabsToClose('closeOthers', 5, 3), []);
  assert.deepEqual(tabsToClose('close', -1, 3), []);
  assert.deepEqual(tabsToClose('splitVertical', 0, 3), []);
});

test('Ctrl+Tab / Ctrl+Shift+Tab cycle and wrap; the label marks unsaved changes', () => {
  assert.equal(cycleTabIndex(0, 3, 1), 1);
  assert.equal(cycleTabIndex(2, 3, 1), 0);
  assert.equal(cycleTabIndex(0, 3, -1), 2);
  assert.equal(cycleTabIndex(-1, 3, 1), 0);
  assert.equal(cycleTabIndex(0, 0, 1), -1);
  assert.equal(tabLabel({ fileName: 'A-101.pdf', modified: true }), '*A-101.pdf');
  assert.equal(tabLabel({ fileName: 'A-101.pdf' }), 'A-101.pdf');
});

test('tab strip: no "+", a ▾ list, the shared context menu, Ctrl+Tab, and every menu action handled', () => {
  const tabs = lees('./DocumentTabs.jsx');
  assert.doesNotMatch(tabs, /document-tabs-add|handleAddClick/);
  assert.match(tabs, /class="document-tabs-list"/);
  assert.match(tabs, /showDocListMenu\(/);
  assert.match(tabs, /showDocTabMenu\(/);
  assert.match(tabs, /e\.key !== 'Tab' \|\| !e\.ctrlKey/);
  assert.match(tabs, /cycleTabIndex\(state\.activeDocumentIndex, count, e\.shiftKey \? -1 : 1\)/);
  const all = docTabMenuItems({ index: 0, count: 2, desktop: true, canReveal: true, multiView: true }).filter(Boolean);
  const handled = ['close', 'closeAll', 'closeOthers', 'detach', 'showInFolder', 'properties'];
  for (const { id } of all) {
    if (handled.includes(id)) assert.match(tabs, new RegExp(`case '${id}':`), id);
  }
  const menu = lees('./ContextMenu.jsx');
  assert.match(menu, /runDocTabAction\(item\.id, index\(\)\)/);
  assert.match(menu, /<Match when=\{menuType\(\) === 'docTab'\}>/);
  assert.match(menu, /<Match when=\{menuType\(\) === 'docList'\}>/);
  const css = lees('../../../styles/document-tabs.css');
  const strip = css.match(/#document-tabs\.document-tabs \{[^}]*\}/)[0];
  assert.match(strip, /height: 34px;/);
  const active = css.match(/#document-tabs \.document-tab\.active \{[^}]*\}/)[0];
  assert.match(active, /background: var\(--theme-content-bg\);/, 'the active tab takes the canvas colour');
  for (const lang of ['en', 'nl']) {
    const ctx = JSON.parse(lees(`../../i18n/locales/${lang}/context.json`));
    for (const k of ['close', 'closeAll', 'closeOthers', 'splitVertical', 'splitHorizontal', 'switch', 'detach', 'properties', 'openDocuments']) {
      assert.ok(ctx.docTab?.[k], `${lang} docTab.${k}`);
    }
  }
});
