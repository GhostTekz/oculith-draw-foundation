// Panel hosts (the external editor workspace WP2): the panel registry, what the hosts and
// access bars show, attach/move and its persistence, profile switching,
// collapse / Hide Panels, the old left-panel API on top of the hosts, and the
// right vertical toolbar. Real workspaceLayout store; preferences.js and the
// left-panel module are stubs (../../../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('../../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { state } = await import('../../../core/state.ts');
const wl = await import('../../stores/workspaceLayout.js');
const reg = await import('./panelRegistry.js');
const logic = await import('./panelHostLogic.js');
const actions = await import('./panelActions.js');
const left = await import('../../stores/leftPanelStore.js');
const profiles = await import('../../stores/workspaceProfiles.js');
const sizes = await import('../../stores/panelLayout.js');
const bar = await import('./verticalToolbarItems.js');

const lees = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');
const locale = (lang, ns) => JSON.parse(lees(`../../../i18n/locales/${lang}/${ns}.json`));
const lookup = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);

function reset(prefs = {}) {
  state.preferences = { ...prefs };
  wl.restoreWorkspaceLayout();
}
// state is a Solid mutable store: compare plain copies.
const stored = () => JSON.parse(JSON.stringify(state.preferences.workspaceLayout));

test('the registry has an entry for every layout panel id, with title, icon, body and shortcut', () => {
  assert.deepEqual([...reg.PANEL_ORDER].sort(), [...wl.PANEL_IDS].sort());
  for (const id of wl.PANEL_IDS) {
    const e = reg.getPanelEntry(id);
    assert.ok(e, id);
    assert.equal(e.id, id);
    assert.match(e.title, /^[a-z]+:[\w.]+$/, `${id} title is an 'ns:key' i18n key`);
    const [ns, key] = e.title.split(':');
    assert.equal(typeof lookup(locale('en', ns), key), 'string', `${id}: ${e.title} exists in en`);
    assert.match(e.icon, /^<svg[\s\S]+<\/svg>$/, `${id} icon`);
    assert.equal(typeof e.component, 'function', `${id} body component`);
  }
  // the external editor panel shortcuts (spec §1.11), one panel each.
  const keys = Object.fromEntries(wl.PANEL_IDS.map((id) => [id, reg.getPanelEntry(id).shortcut]).filter(([, s]) => s));
  assert.deepEqual(keys, {
    thumbnails: 'Alt+T', sheets: 'Alt+2', bookmarks: 'Alt+B', layers: 'Alt+Y', toolChest: 'Alt+X',
    links: 'Alt+N', measurements: 'Alt+U', properties: 'Alt+P', formFields: 'Alt+Q', signatures: 'Alt+4',
    search: 'Alt+1', markupsList: 'Alt+L', spaces: 'Alt+S',
  });
  assert.equal(reg.panelForShortcut({ altKey: true, code: 'KeyS' }), 'spaces');
  assert.equal(reg.panelForShortcut({ altKey: true, code: 'KeyP' }), 'properties');
  assert.equal(reg.panelForShortcut({ altKey: true, code: 'Digit1' }), 'search');
  assert.equal(reg.panelForShortcut({ altKey: true, ctrlKey: true, code: 'KeyP' }), null);
  assert.equal(reg.panelForShortcut({ altKey: false, code: 'KeyP' }), null);
  assert.deepEqual(wl.PANEL_IDS.filter((id) => reg.getPanelEntry(id).sizeSlider), ['thumbnails', 'toolChest'],
    'the external editor size slider under Thumbnails and the Tool Chest');
  assert.deepEqual([logic.clampPanelZoom(undefined), logic.clampPanelZoom('1.24'), logic.clampPanelZoom(9), logic.clampPanelZoom(0.1)],
    [1, 1.2, 1.6, 0.6]);
  assert.equal(reg.panelTitle('toolChest', (k) => k), 'common:panelHost.toolChest');
  assert.equal(reg.panelTooltip('properties', () => 'Properties'), 'Properties (Alt+P)');
});

test('the panel bodies are the existing components (Links = destinations + links)', () => {
  const src = lees('./panelRegistry.js');
  for (const body of ['ThumbnailsPanel', 'SheetsPanel', 'BookmarksPanel', 'LayersPanel', 'MeasurementsPanel',
    'FormFieldsPanel', 'SignaturesPanel', 'AttachmentsPanel', 'TagsPanel', 'SchedulesPanel', 'AnnotationsPanel']) {
    assert.match(src, new RegExp(`import\\('\\.\\./left-panel/panels/${body}\\.jsx'\\)`), body);
  }
  assert.match(src, /import\('\.\.\/SymbolPalette\.jsx'\), 'ToolChestPanel'\)/);
  assert.match(src, /import\('\.\.\/properties-panel\/PropertiesPanel\.jsx'\)/);
  const links = lees('./LinksPanels.jsx');
  assert.match(links, /<DestinationsPanel \/>[\s\S]*<LinksPanel \/>/);
});

test('host rendering: access bars, open hosts and active tabs per profile', () => {
  const l = wl.createProfileLayout('oculith');
  assert.equal(logic.isAccessBarVisible(l, 'left'), true);
  assert.equal(logic.isAccessBarVisible(l, 'right'), false, 'no right bar without right tabs');
  assert.equal(logic.isAccessBarVisible(l, 'bottom'), true);
  assert.deepEqual(['left', 'right', 'bottom'].map((h) => logic.isHostOpen(l, h)), [true, false, true]);
  const items = logic.accessBarItems(l, 'left');
  assert.equal(items.length, 14);
  assert.equal(items.at(-1).id, 'spaces', 'Spaces is the last Community left tab');
  assert.deepEqual(items.filter((i) => i.active).map((i) => i.id), ['toolChest']);
  assert.deepEqual(logic.accessBarItems(l, 'bottom'), [{ id: 'markupsList', active: true }, { id: 'quantities', active: false }]);
  assert.equal(logic.isPanelShown(l, 'toolChest'), true);
  assert.equal(logic.isPanelShown(l, 'properties'), false, 'Properties is a left tab, not shown by default');

  const adv = wl.createProfileLayout('oculithAdvanced');
  assert.equal(logic.isAccessBarVisible(adv, 'right'), true);
  assert.equal(logic.isPanelShown(adv, 'properties'), true);
  assert.equal(logic.isPanelShown(adv, 'thumbnails'), true);

  const collapsed = wl.withHostCollapsed(l, 'left', true);
  assert.equal(logic.isHostOpen(collapsed, 'left'), false);
  assert.ok(logic.accessBarItems(collapsed, 'left').every((i) => !i.active), 'no tab lit while collapsed');
  assert.equal(logic.isAccessBarVisible(collapsed, 'left'), true, 'left bar stays');
});

test('clicking a tab: the open active tab collapses its host, others activate and open', () => {
  let l = wl.createProfileLayout('oculith');
  l = logic.withTabClicked(l, 'left', 'toolChest');
  assert.equal(l.hosts.left.collapsed, true);
  l = logic.withTabClicked(l, 'left', 'toolChest');
  assert.deepEqual([l.hosts.left.collapsed, l.hosts.left.active], [false, 'toolChest']);
  l = logic.withTabClicked(l, 'left', 'bookmarks');
  assert.deepEqual([l.hosts.left.collapsed, l.hosts.left.active], [false, 'bookmarks']);
  assert.equal(logic.withTabClicked(l, 'left', 'markupsList'), l, 'a tab of another host is ignored');

  reset();
  actions.clickAccessTab('bottom', 'markupsList');
  assert.equal(wl.getHost('bottom').collapsed, true);
  actions.clickAccessTab('bottom', 'quantities');
  assert.deepEqual([wl.getHost('bottom').collapsed, wl.getActivePanel('bottom')], [false, 'quantities']);
  assert.equal(stored().hosts.bottom.active, 'quantities', 'persisted');
});

test('Attach ▸ Right moves Properties, the move is persisted and survives a reload', () => {
  reset();
  const targets = logic.attachTargets(wl.workspaceLayout(), 'properties');
  assert.deepEqual(targets, [{ host: 'left', current: true }, { host: 'right', current: false }, { host: 'bottom', current: false }]);
  actions.attachPanel('properties', 'right');
  assert.equal(wl.getPanelHost('properties'), 'right');
  assert.deepEqual(stored().hosts.right, { tabs: ['properties'], active: 'properties', size: 300, collapsed: false });
  // "Reload": a fresh restore from the saved preferences.
  const saved = JSON.parse(JSON.stringify(state.preferences));
  reset(saved);
  assert.equal(wl.getPanelHost('properties'), 'right');
  assert.equal(logic.isPanelShown(wl.workspaceLayout(), 'properties'), true);
  // Attach to the host it is in: just activates it.
  actions.attachPanel('properties', 'right');
  assert.deepEqual(wl.getHost('right').tabs, ['properties']);
  // Hide, then Show ▸ brings it back to its Oculith host (left).
  actions.hidePanelById('properties');
  assert.equal(wl.getPanelHost('properties'), null);
  const show = logic.showMenuItems(wl.workspaceLayout(), reg.PANEL_ORDER);
  assert.equal(show.find((i) => i.id === 'properties').shown, false);
  actions.activatePanel('properties');
  assert.equal(wl.getPanelHost('properties'), 'left');
});

test('Alt+P toggles Properties in the left host; the keydown guard skips handled events', () => {
  reset();
  const key = (code, extra = {}) => ({ altKey: true, code, key: '', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra });
  const ev = key('KeyP');
  assert.equal(actions.handlePanelShortcut(ev), true);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(wl.getActivePanel('left'), 'properties');
  assert.equal(logic.isPanelShown(wl.workspaceLayout(), 'properties'), true);
  actions.handlePanelShortcut(key('KeyP'));
  assert.equal(wl.getHost('left').collapsed, true, 'again: its host collapses');
  assert.equal(actions.handlePanelShortcut(key('KeyP', { defaultPrevented: true })), false, 'an earlier binding wins');
  assert.equal(wl.getHost('left').collapsed, true);
  assert.equal(actions.handlePanelShortcut(key('KeyZ')), false);
  // installPanelShortcuts binds once.
  const added = [];
  const target = { addEventListener: (type) => added.push(type) };
  assert.equal(actions.installPanelShortcuts(target), true);
  assert.equal(actions.installPanelShortcuts(target), false, 'a second install is a no-op');
  assert.deepEqual(added, ['keydown']);
});

test('Shift+F4 hides every host and restores the ones that were open', () => {
  reset();
  wl.movePanel('properties', 'right');
  wl.setHostCollapsed('bottom', true);
  const f4 = { key: 'F4', shiftKey: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  assert.equal(actions.handlePanelShortcut(f4), true);
  assert.deepEqual(['left', 'right', 'bottom'].map((h) => wl.getHost(h).collapsed), [true, true, true]);
  assert.equal(stored().hosts.left.collapsed, true, 'persisted');
  actions.hideAllPanels();
  assert.deepEqual(['left', 'right', 'bottom'].map((h) => wl.getHost(h).collapsed), [false, false, true],
    'only the hosts that were open come back');
  // Pure helper: nothing open and no memory → every host with tabs opens.
  let l = wl.createProfileLayout('oculith');
  for (const h of wl.HOSTS) l = wl.withHostCollapsed(l, h, true);
  const { layout, memory } = logic.toggleAllHosts(l, null);
  assert.equal(memory, null);
  assert.deepEqual(['left', 'right', 'bottom'].map((h) => layout.hosts[h].collapsed), [false, true, false],
    'the empty right host stays shut');
});

test('edge drag and keys resize within the limits; small moves count as clicks', () => {
  assert.equal(logic.resizedHostSize('left', 300, 60), 360);
  assert.equal(logic.resizedHostSize('left', 300, 60, { rtl: true }), 240);
  assert.equal(logic.resizedHostSize('right', 300, -100), 400, 'right grows when dragged left');
  assert.equal(logic.resizedHostSize('bottom', 230, -50), 280, 'bottom grows when dragged up');
  assert.equal(logic.resizedHostSize('left', 300, -500), 200, 'clamped to 200');
  assert.equal(logic.resizedHostSize('bottom', 230, -900), 520, 'clamped to 520');
  assert.equal(logic.keyResizedHostSize('left', 300, 'ArrowRight'), 316);
  assert.equal(logic.keyResizedHostSize('right', 300, 'ArrowRight'), 284);
  assert.equal(logic.keyResizedHostSize('bottom', 230, 'ArrowUp'), 246);
  assert.equal(logic.keyResizedHostSize('bottom', 230, 'Enter'), null);
  assert.equal(logic.isEdgeClick(2, -3), true);
  assert.equal(logic.isEdgeClick(4, 0), false);
  // The old size API maps onto the hosts.
  reset();
  sizes.setPanelSize('left', 333, true);
  sizes.setPanelSize('markups', 250, true);
  // Properties sits in the left host in the Oculith profile, so it reports the left size.
  assert.deepEqual([sizes.panelSize('left'), sizes.panelSize('markups'), sizes.panelSize('properties')], [333, 250, 333]);
  assert.equal(stored().profileSizes.oculith.left, 333);
});

test('profiles: Oculith Advanced shows Thumbnails left and Properties right; sizes persist per profile', () => {
  reset();
  wl.setHostSize('left', 340);
  assert.equal(profiles.applyWorkspaceProfile('oculithAdvanced'), true);
  assert.equal(profiles.activeWorkspaceProfile(), 'oculithAdvanced');
  let l = wl.workspaceLayout();
  assert.deepEqual([l.hosts.left.active, l.hosts.left.size], ['thumbnails', 260]);
  assert.deepEqual([l.hosts.right.active, l.hosts.right.size, l.hosts.right.collapsed], ['properties', 300, false]);
  assert.equal(stored().profile, 'oculithAdvanced');
  wl.setHostSize('right', 360);
  profiles.applyWorkspaceProfile('oculith');
  l = wl.workspaceLayout();
  assert.deepEqual([l.hosts.left.active, l.hosts.left.size, l.hosts.right.tabs.length], ['toolChest', 340, 0]);
  profiles.applyWorkspaceProfile('review');
  assert.equal(wl.activeProfile(), 'oculithAdvanced', 'old ids still work');
  assert.equal(wl.getHost('right').size, 360, 'its remembered size');
  assert.equal(profiles.applyWorkspaceProfile('nope'), false);
  assert.deepEqual([...profiles.WORKSPACE_PROFILES], ['oculith', 'oculithAdvanced', 'quantityTakeoff', 'document']);
  profiles.applyWorkspaceProfile('document');
  assert.equal(wl.getHost('bottom').collapsed, true);
  assert.equal(wl.isToolbarVisible('markup'), false);
});

test('the old left-panel API works on the hosts', () => {
  reset();
  assert.equal(left.toPanelId('annotations'), 'markupsList');
  assert.equal(left.toPanelId('destinations'), 'links');
  assert.equal(left.toPanelId('schedules'), 'quantities');
  assert.equal(left.toPanelId('form-fields'), 'formFields');
  assert.equal(left.toPanelId('nope'), null);
  assert.equal(left.toLegacyId('markupsList'), 'annotations');
  assert.equal(left.activeTab(), 'toolChest', 'the left host active panel by default');
  assert.equal(left.panelShown('annotations'), true, 'the Markups List is open in the bottom host');
  left.setActiveTab('annotations');
  assert.equal(left.activeTab(), 'annotations');
  left.setCollapsed(true);
  assert.equal(wl.getHost('bottom').collapsed, true, 'collapses the host of the active tab');
  assert.equal(left.panelShown('annotations'), false);
  assert.equal(left.activeTab(), 'toolChest', 'a hidden focus falls back to the left host');
  left.switchToLeftPanelTab('schedules');
  assert.deepEqual([wl.getActivePanel('bottom'), wl.getHost('bottom').collapsed], ['quantities', false]);
  left.toggleLeftPanelCollapsed();
  assert.equal(wl.getHost('left').collapsed, true);
  assert.equal(left.collapsed(), false, 'the focused Quantities host is open');
  left.switchToLeftPanelTab('layers');
  assert.deepEqual([wl.getActivePanel('left'), wl.getHost('left').collapsed, left.activeTab()], ['layers', false, 'layers']);
});

test('right vertical toolbar: Markup | Draw | Measure groups and the overflow split', () => {
  const all = bar.toolbarEntries(() => true);
  const groups = all.filter((e) => !e.separator).map((e) => e.group);
  assert.deepEqual([...new Set(groups)], ['markup', 'draw', 'measure']);
  assert.equal(all.filter((e) => e.separator).length, 2);
  // Command ids for components/Toolbar.jsx (tools.markup.* / tools.measure.*).
  for (const e of all.filter((x) => !x.separator)) assert.match(e.command, /^(tools|edit)\.[\w.]+$/, e.command);
  assert.deepEqual(bar.toolbarIds(bar.toolbarEntries((id) => id === 'measure')).slice(0, 2), ['tools.measure.length', 'tools.measure.polylength']);
  assert.ok(bar.toolbarIds(all).filter((id) => id === '|').length === 2);
  assert.ok(!bar.toolbarEntries(() => true, (id) => id !== 'edit.snapshot').some((e) => e.command === 'edit.snapshot'), 'unregistered ids drop out');
  const measureOnly = bar.toolbarEntries((id) => id === 'measure');
  assert.ok(measureOnly.every((e) => e.group === 'measure' && !e.separator));
  assert.deepEqual(bar.toolbarEntries(() => false), []);
  const total = all.reduce((s, e) => s + (e.separator ? bar.SEPARATOR_PX : bar.BUTTON_PX), 0);
  assert.deepEqual(bar.fitToolbarEntries(all, total), { visible: all, overflow: [] });
  const fit = bar.fitToolbarEntries(all, 300);
  assert.equal(fit.visible.length + fit.overflow.length <= all.length, true);
  const used = fit.visible.reduce((s, e) => s + (e.separator ? bar.SEPARATOR_PX : bar.BUTTON_PX), 0);
  assert.ok(used <= 300 - bar.OVERFLOW_PX);
  assert.ok(!fit.visible.at(-1).separator && !fit.overflow[0].separator && !fit.overflow.at(-1).separator);
  const tools = (list) => list.filter((e) => !e.separator).map((e) => e.command);
  assert.deepEqual([...tools(fit.visible), ...tools(fit.overflow)], tools(all), 'every tool stays reachable');
});

test('App puts the hosts and the right toolbar in the content row; no rail, dock or docked Properties', () => {
  const app = lees('../../App.jsx');
  const content = app.slice(app.indexOf('<div class="content">'), app.indexOf('<MarkupsDock />'));
  assert.match(content, /^\s*<div class="content">\s*<PanelHost host="left" \/>/);
  assert.match(content, /<OrderedDockedPalettes side="right" \/>\s*<VerticalToolbar \/>\s*<PanelHost host="right" \/>\s*<\/div>/);
  assert.doesNotMatch(app, /<LeftPanel|<PropertiesPanel|<ElementVisibilityPanel/);
  assert.match(lees('../MarkupsDock.jsx'), /<PanelHost host="bottom" \/>/);
  const main = lees('../../../main.js');
  assert.ok(main.indexOf('restoreWorkspaceLayout();') > main.indexOf('await loadPreferences();\n'), 'layout restored after preferences load');
  assert.ok(main.indexOf('restoreWorkspaceLayout();') < main.indexOf('render(() => App()'), 'and before the first render');
  for (const lang of ['en', 'nl']) {
    const ph = locale(lang, 'common').panelHost;
    for (const k of ['toolChest', 'markupsList', 'quantities', 'sheets', 'show', 'hide', 'attach', 'left', 'right', 'bottom']) {
      assert.equal(typeof ph[k], 'string', `${lang} panelHost.${k}`);
    }
    for (const p of wl.PROFILE_IDS) assert.equal(typeof ph.profile[p], 'string', `${lang} profile ${p}`);
  }
});
