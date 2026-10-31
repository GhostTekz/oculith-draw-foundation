// The menu bar and the command registry (docs/WORKSPACE-SPEC.md §4, §7
// WP1): every ribbon button runs a registry command that a menu also
// offers, every menu entry names a registered command, labels exist in en
// and nl, the command palette finds commands by their menu wording, and no
// key is bound to two different actions. Runs the real registry and state
// store (browser build of Solid, see ../../core/app-test-hooks.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const reg = await import('./index.js');
const { MENUS, menuCommandIds, walkMenus, menuPathOf, menuIndexForMnemonic } = await import('./menus.js');
const { RIBBON_BUTTON_COMMANDS } = await import('./ribbon-buttons.js');
const { paletteResults, PALETTE_HIDDEN } = await import('./palette.js');
const { SHORTCUTS, shortcutKeys } = await import('../../tools/shortcut-table.js');
const { PANEL_SHORTCUTS } = await import('./window.js');
const { TOOL_OF_COMMAND } = await import('./tools.js');

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const RIBBON_DIR = new URL('../components/ribbon/', import.meta.url);
const tabFiles = readdirSync(RIBBON_DIR).filter((f) => /Tab\.jsx$/.test(f) && f !== 'RibbonTab.jsx');

const locale = (lang, ns) => JSON.parse(read(`../../i18n/locales/${lang}/${ns}.json`).replace(/^﻿/, ''));
const bundles = {};
function translate(lang, key) {
  const [ns, path] = key.includes(':') ? key.split(':') : ['common', key];
  bundles[`${lang}/${ns}`] ??= locale(lang, ns);
  return path.split('.').reduce((o, k) => o?.[k], bundles[`${lang}/${ns}`]);
}
const tEn = (key) => translate('en', key) ?? key;

// Handlers in the ribbon tabs that only drive the tab's own UI (open a
// dropdown, a local dialog) and are not commands. Anything else must run a
// registry command.
const UI_LOCAL = [
  'setMoreOpen(!moreOpen())', // FormatTab: style gallery "more" dropdown
  'setToolsOpen(!toolsOpen())', // FormatTab: style tools dropdown
  'openCreateDialog', // FormatTab: name dialog for a new style preset
  '{ setToolsOpen(false); setManageOpen(true); }', // FormatTab: manage presets dialog
  'setCreateOpen(false)', 'confirmCreate', 'setManageOpen(false)', // FormatTab dialogs
  'deleteStylePreset(p.id)', // FormatTab: manage-presets dialog row
  'setAlignMenuOpen(!alignMenuOpen())', // ArrangeTab: "align to" dropdown
];

function handlers(source) {
  const out = [];
  const re = /\bon(?:Main)?Click=\{/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) break;
    }
    out.push(source.slice(m.index + m[0].length, i).trim());
  }
  return out;
}

test('every ribbon onClick runs a registry command that a menu offers', () => {
  const menuIds = menuCommandIds();
  let commands = 0;
  for (const file of tabFiles) {
    for (const body of handlers(read(`../components/ribbon/${file}`))) {
      const run = body.match(/runCommand\('([\w.]+)'/);
      if (!run) {
        assert.ok(UI_LOCAL.some((h) => body === h || body === `() => ${h}`), `${file}: handler is not a command: ${body}`);
        continue;
      }
      commands++;
      assert.ok(reg.getCommand(run[1]), `${file}: ${run[1]} is registered`);
      assert.ok(menuIds.has(run[1]), `${file}: ${run[1]} is in menus.js`);
    }
  }
  assert.ok(commands >= 190, `all ribbon buttons are commands (${commands})`);
});

test('the File backstage runs registry commands from the menus', () => {
  const src = read('../components/app-menu/AppMenu.jsx');
  const ids = [...src.matchAll(/runCommand\('([\w.]+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length >= 10);
  for (const id of ids) assert.ok(menuCommandIds().has(id), id);
  assert.doesNotMatch(src, /showNewDocDialog|savePDFAs|showPrintDialog|closeWindow/, 'no second implementation');
});

test('RIBBON_BUTTON_COMMANDS matches the ribbon buttons', () => {
  const found = {};
  for (const file of tabFiles) {
    const src = read(`../components/ribbon/${file}`);
    for (const m of src.matchAll(/id="([\w-]+)"/g)) {
      const next = src.slice(m.index + m[0].length).search(/<[A-Za-z/]/);
      const tag = src.slice(m.index, m.index + m[0].length + (next < 0 ? src.length : next));
      const run = tag.match(/runCommand\('([\w.]+)'/);
      if (run) found[m[1]] = run[1];
    }
  }
  const map = Object.fromEntries(Object.entries(RIBBON_BUTTON_COMMANDS).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  assert.deepEqual(map, found);
  assert.equal(RIBBON_BUTTON_COMMANDS['arr-send-back'], 'arrange.sendToBack', 'the id the construction-overview skill names');
});

test('every menu entry names a registered command, and every command is in a menu', () => {
  const missing = [];
  walkMenus((item) => {
    if (item.kind === 'command' && !item.pending && !reg.getCommand(item.command)) missing.push(item.command);
  });
  assert.deepEqual(missing, []);
  const ids = menuCommandIds();
  assert.deepEqual(reg.listCommands().map((c) => c.id).filter((id) => !ids.has(id)), []);
  // Pending entries are commands a later package registers; the WP5 split
  // views (MultiView) are registered now, so none is left.
  const pending = [];
  walkMenus((item) => { if (item.pending) pending.push(item.command); });
  assert.deepEqual(pending, []);
  for (const id of ['view.splitVertical', 'view.splitHorizontal', 'view.unsplit', 'view.syncDocument', 'view.syncPage']) {
    assert.deepEqual(menuPathOf(id), ['common:menu.view'], id);
  }
  // The Navigation bar commands (WP3) are live View menu entries.
  for (const id of ['view.darkMode', 'view.dimmer', 'view.previousView', 'view.nextView', 'tools.toolbar.navigation', 'tools.toolbar.status',
    'tools.toolbar.markup', 'tools.toolbar.measure']) {
    assert.deepEqual(menuPathOf(id), ['common:menu.view'], id);
  }
});

test('the menu bar has the external editor menus in order with their mnemonics', () => {
  assert.deepEqual(MENUS.map((m) => m.id), ['oculith', 'file', 'edit', 'view', 'document', 'batch', 'tools', 'window', 'help']);
  assert.deepEqual(MENUS.map((m) => m.mnemonic), ['O', 'F', 'E', 'V', 'D', 'B', 'T', 'W', 'H']);
  assert.equal(menuIndexForMnemonic('v'), 3);
  const view = MENUS[3].items;
  assert.deepEqual(view.slice(0, 3), ['view.fitPage', 'view.fitWidth', 'view.actualSize']);
  const labels = [];
  walkMenus((item, path) => { if (path.length === 1 && path[0] === 'common:menu.tools' && item.kind === 'submenu') labels.push(item.label); });
  for (const sub of ['markup', 'measure', 'stamp', 'form', 'signature', 'toolbars']) {
    assert.ok(labels.includes(`common:menu.${sub}`), `Tools > ${sub}`);
  }
  // Window > Panels lists every workspace panel.
  const panels = [];
  walkMenus((item, path) => { if (path.at(-1) === 'common:menu.panels') panels.push(item.command); });
  assert.equal(panels.length, 18);
  assert.ok(panels.includes('window.panel.spaces'), 'Window > Panels > Spaces');
});

test('every command and menu label exists in en and nl', () => {
  const keys = new Set(reg.listCommands().map((c) => c.label));
  walkMenus((item) => { for (const k of [item.label, item.pending]) if (k) keys.add(k); });
  for (const m of MENUS) keys.add(m.label);
  for (const lang of ['en', 'nl']) {
    for (const key of keys) assert.equal(typeof translate(lang, key), 'string', `${lang} ${key}`);
  }
});

test('Find Tools + Commands: "extract" finds Document > Extract Pages first', () => {
  const rows = paletteResults('extract', tEn);
  assert.equal(rows[0].cmd.id, 'document.extractPages');
  assert.deepEqual(rows[0].path, ['Document']);
  assert.equal(reg.commandLabel(rows[0].cmd, tEn), 'Extract Pages…');
  assert.deepEqual(menuPathOf('arrange.sendToBack'), ['common:menu.edit', 'common:menu.arrange', 'common:menu.order']);
  // Other wordings reach commands too: keywords and the external editor names.
  assert.equal(paletteResults('deskew', tEn)[0].cmd.id, 'document.straighten');
  assert.equal(paletteResults('combine', tEn)[0].cmd.id, 'batch.combine');
  assert.equal(paletteResults('thumb', tEn)[0].cmd.id, 'window.panel.thumbnails');
  for (const id of PALETTE_HIDDEN) assert.ok(!paletteResults('', tEn, 1000).some((r) => r.cmd.id === id), id);
});

test('no key is bound to two actions: commands agree with the shortcut table', () => {
  const byKey = new Map();
  for (const cmd of reg.listCommands()) {
    if (!cmd.shortcut) continue;
    assert.ok(!byKey.has(cmd.shortcut), `${cmd.shortcut}: ${byKey.get(cmd.shortcut)} and ${cmd.id}`);
    byKey.set(cmd.shortcut, cmd.id);
  }
  const table = new Map();
  for (const entry of SHORTCUTS) {
    if (entry.sequence) continue;
    for (const k of shortcutKeys(entry)) table.set(k, entry);
  }
  for (const [key, id] of byKey) {
    const entry = table.get(key);
    if (!entry) continue; // shown for reference; bound by its own handler (e.g. Delete in the canvas)
    if (entry.run) assert.equal(entry.run, id, `${key} runs ${entry.run}, the menu shows ${id}`);
    if (entry.tool && TOOL_OF_COMMAND[id]) assert.equal(TOOL_OF_COMMAND[id], entry.tool, `${key}: ${id} selects ${entry.tool}`);
  }
  // Every table key that runs a command shows on that command (menus, palette).
  for (const entry of SHORTCUTS.filter((e) => e.run)) {
    assert.ok(reg.getCommand(entry.run), `${entry.id}: ${entry.run} is registered`);
    assert.ok(shortcutKeys(entry).includes(reg.getCommand(entry.run).shortcut), `${entry.id}: ${entry.run} shows its key`);
  }
  for (const [panel, key] of Object.entries(PANEL_SHORTCUTS)) {
    assert.equal(table.get(key)?.run, `window.panel.${panel}`, key);
  }
});

test('Alt+B and Alt+T are the panels; the other menu letters open their menu', () => {
  const taken = MENUS.filter((m) => reg.listCommands().some((c) => c.shortcut === `Alt+${m.mnemonic}`)).map((m) => m.mnemonic);
  assert.deepEqual(taken, ['B', 'T']);
  const mnemonics = SHORTCUTS.find((e) => e.id === 'menuMnemonics');
  assert.deepEqual(shortcutKeys(mnemonics), MENUS.filter((m) => !taken.includes(m.mnemonic)).map((m) => `Alt+${m.mnemonic}`));
  assert.equal(SHORTCUTS.find((e) => e.id === 'menuBar').keys, 'F9');
  assert.match(read('../../tools/shortcut-table.js'), /Alt\+B, Alt\+T {2}Also the Batch and Tools menu mnemonics\. The panels win/);
});

test('the menu bar replaces the title bar and the ribbon in the layout', () => {
  const app = read('../App.jsx');
  assert.match(app, /<MenuBar \/>/);
  assert.doesNotMatch(app, /<TitleBar \/>/);
  assert.match(app, /<Show when=\{state\.preferences\.legacyRibbon === true\}>\s*<div class="ribbon-container">\s*<Ribbon \/>/);
  const top = app.slice(app.indexOf('<MenuBar />'), app.indexOf('<DocumentTabs />'));
  assert.ok(top.indexOf('<PropertiesToolbar />') > top.indexOf('</Show>'), 'Properties toolbar directly under the menu row');
  assert.equal(read('../../core/constants.ts').match(/legacyRibbon: (\w+),/)?.[1], 'false');
});

test('the right vertical toolbar lists registered tool commands only', async () => {
  const { TOOLBAR_GROUPS } = await import('../components/panels/verticalToolbarItems.js');
  for (const group of TOOLBAR_GROUPS) {
    for (const id of group.items) assert.ok(reg.getCommand(id), `${group.id}: ${id}`);
  }
});

test('Batch > Link and Document > Page Labels run registered commands, not placeholders', () => {
  const batch = MENUS.find((m) => m.id === 'batch');
  const link = batch.items.find((i) => i.submenu === 'common:menu.batchLink');
  assert.deepEqual(link.items, ['batch.link', 'batch.linkRemove', '-', 'batch.setLink', 'document.bookmarksFromLabels']);
  assert.ok(!batch.items.some((i) => i.placeholder === 'common:menu.batchPending.link'));
  // the external editor order: ... Apply Stamp, Link, Compare ...
  // Apply Stamp and Compare are live entries now (WP15), so find them as such.
  const at = (key) => batch.items.findIndex((i) => i === `batch.${key}`
    || i.placeholder === `common:menu.batchPending.${key}` || i.label === `common:menu.batchPending.${key}`);
  assert.ok(at('applyStamp') >= 0 && at('compare') >= 0);
  assert.ok(at('applyStamp') < batch.items.indexOf(link) && batch.items.indexOf(link) < at('compare'));
  for (const id of ['document.pageLabels', 'batch.link', 'batch.linkRemove', 'batch.setLink', 'document.bookmarksFromLabels']) assert.ok(reg.getCommand(id), id);
  assert.deepEqual(menuPathOf('document.pageLabels'), ['common:menu.document']);
});
