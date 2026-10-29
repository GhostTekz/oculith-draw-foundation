import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { edition as foundation } from './community.js';
import { composeAddons, resolvePluginEntries } from './compose-addons.js';

const addon = (id, fields = {}) => ({ apiVersion: 1, id, ...fields });
const panel = (id, shortcut) => ({ id, title: id, component: () => null, shortcut });
const command = (id, shortcut) => ({ id, label: id, category: 'file', run: () => {}, shortcut });

test('two independent contributions extend the Foundation edition in order', () => {
  const result = composeAddons(foundation, [
    { id: 'sample.one', addon: addon('sample.one', {
      panels: [panel('sample-one-panel', 'Alt+5')],
      fileCommands: [command('sample.one.open', 'Ctrl+Alt+5')],
      fileMenuItems: ['sample.one.open'],
      dialogs: { 'sample-one-dialog': () => null },
    }) },
    { id: 'sample.two', addon: addon('sample.two', {
      panels: [panel('sample-two-panel', 'Alt+6')],
      toolbarItems: [{ id: 'sample-two-button', title: 'Two', run: () => {} }],
      symbolCategories: [{ id: 'sample-two-symbols', symbols: [] }],
      symbolTemplates: [{ id: 'sample-two-template', render: () => [] }],
    }) },
  ]);
  assert.deepEqual(result.accepted, ['sample.one', 'sample.two']);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.edition.panelIds, ['sample-one-panel', 'sample-two-panel']);
  assert.deepEqual(result.edition.fileMenuItems, ['sample.one.open']);
  assert.equal(result.edition.panels[0].id, 'sample-one-panel');
  assert.equal(result.edition.panels[1].id, 'sample-two-panel');
  assert.deepEqual(foundation.panelIds, []);
});

test('an invalid middle package cannot affect later packages', () => {
  const result = composeAddons(foundation, [
    { id: 'one', addon: addon('one', { panels: [panel('shared', 'Alt+5')] }) },
    { id: 'bad', addon: addon('bad', { panels: [panel('shared', 'Alt+6')] }) },
    { id: 'two', addon: addon('two', { panels: [panel('unique', 'Alt+7')] }) },
  ]);
  assert.deepEqual(result.accepted, ['one', 'two']);
  assert.match(result.rejected[0].error.message, /Duplicate panels id/);
  assert.deepEqual(result.edition.panelIds, ['shared', 'unique']);
});

test('core ids, shortcuts, and first-milestone unsupported hooks are rejected', () => {
  const cases = [
    addon('bad', { panels: [panel('search')] }),
    addon('bad', { fileCommands: [command('file.open')] }),
    addon('bad', { fileCommands: [command('bad.save', 'Ctrl+S')] }),
    addon('bad', { fileMenuItems: ['missing.command'] }),
    addon('bad', { dialogs: { preferences: () => null } }),
    addon('bad', { pdf: { readWorkspace() {} } }),
    addon('bad', { helper: '/bin/helper' }),
    addon('bad', { account: {} }),
    addon('bad', { branding: {} }),
    addon('bad', { hooks: {} }),
  ];
  for (const bad of cases) {
    const result = composeAddons(foundation, [{ id: 'bad', addon: bad }]);
    assert.deepEqual(result.accepted, []);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.edition, foundation);
  }
  const template = composeAddons(foundation, [{ id: 'bad', addon: addon('bad', {
    symbolTemplates: [{ id: 'door' }],
  }) }], { reservedTemplateIds: ['door'] });
  assert.deepEqual(template.accepted, []);
});

test('v1 full edition stays the base when contributions fail or succeed', () => {
  const fullEdition = { ...foundation, id: 'edition', productName: 'Custom Edition', panels: [panel('existing', 'Alt+5')], panelIds: ['existing'] };
  const result = composeAddons(fullEdition, [
    { id: 'bad', addon: addon('bad', { panels: [panel('other', 'Alt+5')] }) },
    { id: 'good', addon: addon('good', { panels: [panel('new', 'Alt+6')] }) },
  ]);
  assert.deepEqual(result.accepted, ['good']);
  assert.equal(result.edition.productName, 'Custom Edition');
  assert.deepEqual(result.edition.panelIds, ['existing', 'new']);
});

test('undo restorers are scoped to their package and fall through to the full edition', () => {
  const calls = [];
  const fullEdition = { ...foundation, undo: { restoreExtensionState(...args) {
    calls.push(['base', ...args]); return true;
  } } };
  const doc = {};
  const result = composeAddons(fullEdition, ['one', 'two'].map((id) => ({ id,
    addon: { apiVersion: 2, id, undo: { restoreExtensionState(...args) {
      calls.push([id, ...args]); return true;
    } } },
  })));
  assert.deepEqual(result.accepted, ['one', 'two']);
  assert.deepEqual(result.rejected, []);
  result.edition.undo.restoreExtensionState(doc, 'one', { value: 1 }, { m: 1 });
  result.edition.undo.restoreExtensionState(doc, 'two', { value: 2 }, null);
  result.edition.undo.restoreExtensionState(doc, 'edition.workspace', { value: 3 }, null);
  assert.deepEqual(calls, [
    ['one', doc, { value: 1 }, { m: 1 }],
    ['two', doc, { value: 2 }, null],
    ['base', doc, 'edition.workspace', { value: 3 }, null],
  ]);
  assert.equal(fullEdition.undo.restoreExtensionState === result.edition.undo.restoreExtensionState, false);
  assert.equal(foundation.undo, undefined);
});

test('malformed undo contributions are rejected without changing the edition', () => {
  for (const undo of [{}, { restoreExtensionState: () => {}, extra: () => {} },
    { restoreExtensionState: true }, []]) {
    const result = composeAddons(foundation, [{ id: 'bad', addon: addon('bad', { apiVersion: 2, undo }) }]);
    assert.deepEqual(result.accepted, []);
    assert.equal(result.edition, foundation);
  }
  const v1 = composeAddons(foundation, [{ id: 'bad', addon: addon('bad', {
    undo: { restoreExtensionState() {} },
  }) }]);
  assert.deepEqual(v1.accepted, []);
});

test('old native binaries fall back to the singleton edition command', async () => {
  const calls = [];
  const entries = await resolvePluginEntries(async (command) => {
    calls.push(command);
    if (command === 'edition_plugins') throw new Error('unknown command');
    return { url: '/edition/plugin.js', css: '' };
  });
  assert.deepEqual(calls, ['edition_plugins', 'edition_plugin']);
  assert.deepEqual(entries, [{ id: 'legacy', kind: 'edition', url: '/edition/plugin.js', css: '' }]);
  assert.deepEqual(await resolvePluginEntries(async () => []), []);
});

test('reserved command, dialog, and shortcut ids track the editor registries', async () => {
  const commandDir = new URL('../solid/commands/', import.meta.url);
  const commands = (await Promise.all((await readdir(commandDir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFile(new URL(name, commandDir), 'utf8')))).join('\n');
  const shortcutTable = await readFile(new URL('../tools/shortcut-table.js', import.meta.url), 'utf8');
  const dialogs = await readFile(new URL('../solid/components/DialogHost.jsx', import.meta.url), 'utf8');
  const commandIds = [...new Set([...commands.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]))]
    .filter((id) => id.includes('.'));
  for (const id of commandIds) {
    const result = composeAddons(foundation, [{ id: 'sample', addon: addon('sample', {
      fileCommands: [command(id)],
    }) }]);
    assert.deepEqual(result.accepted, [], `Built-in command ${id} is not reserved`);
  }
  const dialogMap = dialogs.split('const DIALOG_MAP = {')[1].split('...edition.dialogs')[0];
  for (const [, id] of dialogMap.matchAll(/'([^']+)':/g)) {
    const result = composeAddons(foundation, [{ id: 'sample', addon: addon('sample', {
      dialogs: { [id]: () => null },
    }) }]);
    assert.deepEqual(result.accepted, [], `Built-in dialog ${id} is not reserved`);
  }
  const shortcuts = [...new Set([...(commands + shortcutTable).matchAll(/(?:keys|shortcut):\s*'([^']+)'/g)]
    .map((match) => match[1]).filter((key) => !key.includes(' ')))];
  for (const key of shortcuts) {
    const result = composeAddons(foundation, [{ id: 'sample', addon: addon('sample', {
      fileCommands: [command('sample.command', key)],
    }) }]);
    assert.deepEqual(result.accepted, [], `Built-in shortcut ${key} is not reserved`);
  }
});
