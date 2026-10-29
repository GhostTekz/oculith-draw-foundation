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

test('independent home actions compose without changing the base or hiding later packages', () => {
  const action = (id) => ({ id, label: () => id, run: () => {} });
  const baseAction = action('base.open');
  const base = { ...foundation, home: { title: () => 'Welcome', description: () => 'Open a drawing', actions: [baseAction] } };
  const result = composeAddons(base, [
    { id: 'one', addon: { apiVersion: 2, id: 'one', homeActions: [action('one.open')] } },
    { id: 'bad', addon: { apiVersion: 2, id: 'bad', homeActions: [action('one.open')] } },
    { id: 'two', addon: { apiVersion: 2, id: 'two', homeActions: [action('two.open')] } },
  ]);
  assert.deepEqual(result.accepted, ['one', 'two']);
  assert.match(result.rejected[0].error.message, /Duplicate home action id/);
  assert.deepEqual(result.edition.home.actions.map((item) => item.id), ['base.open', 'one.open', 'two.open']);
  assert.equal(result.edition.home.title(), 'Welcome');
  assert.deepEqual(base.home.actions, [baseAction]);
  assert.deepEqual(composeAddons(foundation, [{ id: 'bad', addon: {
    apiVersion: 1, id: 'bad', homeActions: [action('bad.open')],
  } }]).accepted, []);
});

test('independent document title providers resolve local names in order and survive a failing provider', async () => {
  const calls = [];
  const result = composeAddons(foundation, [
    { id: 'one', addon: { apiVersion: 2, id: 'one', documentTitle: async (path) => {
      calls.push(['one', path]); throw new Error('unavailable local index');
    } } },
    { id: 'two', addon: { apiVersion: 2, id: 'two', documentTitle: (path) => {
      calls.push(['two', path]); return '  Drawing A-101  ';
    } } },
  ]);
  assert.deepEqual(result.accepted, ['one', 'two']);
  assert.equal(await result.edition.documentTitle('/local/drawing.pdf'), '  Drawing A-101  ');
  assert.deepEqual(calls, [['one', '/local/drawing.pdf'], ['two', '/local/drawing.pdf']]);
  assert.equal(foundation.documentTitle, undefined);
  for (const bad of [
    { apiVersion: 1, id: 'bad', documentTitle: () => 'bad' },
    { apiVersion: 2, id: 'bad', documentTitle: 'bad' },
  ]) assert.deepEqual(composeAddons(foundation, [{ id: 'bad', addon: bad }]).accepted, []);
});

test('the latest author provider owns future edits, including an empty signed-out name', async () => {
  const base = { ...foundation, authorName: () => 'Previous person' };
  const result = composeAddons(base, [{ id: 'author', addon: {
    apiVersion: 2, id: 'author', authorName: async () => '',
  } }]);
  assert.deepEqual(result.accepted, ['author']);
  assert.equal(await result.edition.authorName(), '');
  assert.equal(base.authorName(), 'Previous person');
  for (const authorName of ['name', () => 'Name']) {
    const apiVersion = typeof authorName === 'string' ? 2 : 1;
    assert.deepEqual(composeAddons(foundation, [{ id: 'bad', addon: {
      apiVersion, id: 'bad', authorName,
    } }]).accepted, []);
  }
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
