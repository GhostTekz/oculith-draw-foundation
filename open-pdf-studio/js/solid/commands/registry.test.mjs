// Command registry (contract for the plan-review workspace): registering,
// lookup, running with enabled(), checked state, reactivity and the ranked
// search behind Help > Find Tools + Commands. Echte state-store en Solid in
// browserbouw (zie ../../core/app-test-hooks.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();

const { createRoot, createMemo } = await import('solid-js');
const { state } = await import('../../core/state.ts');
const reg = await import('./registry.js');

const SEED_IDS = [
  'file.open', 'file.save', 'file.saveAs', 'file.print', 'edit.undo', 'edit.redo',
  'view.fitPage', 'view.fitWidth', 'view.zoomIn', 'view.zoomOut',
];

function tijdelijk(def) {
  return reg.registerCommand({ label: 'test:x', category: 'help', run: () => 'ran', ...def });
}

test('seed commands are registered with label keys, icons and categories', () => {
  for (const id of SEED_IDS) {
    const cmd = reg.getCommand(id);
    assert.ok(cmd, id);
    assert.match(cmd.label, /^[a-zA-Z]+:[\w.]+$/, `${id} label is an ns:key`);
    assert.match(cmd.icon, /^<svg/);
    assert.equal(cmd.category, id.split('.')[0]);
  }
  assert.deepEqual(reg.listCommands({ category: 'view' }).map((c) => c.id),
    ['view.fitPage', 'view.fitWidth', 'view.zoomIn', 'view.zoomOut']);
});

test('register, get, list, unregister', () => {
  const weg = tijdelijk({ id: 'test.one', label: 'test:one', shortcut: 'Ctrl+J', keywords: ['alpha'] });
  const cmd = reg.getCommand('test.one');
  assert.equal(cmd.shortcut, 'Ctrl+J');
  assert.deepEqual(cmd.keywords, ['alpha']);
  assert.ok(Object.isFrozen(cmd));
  assert.ok(reg.listCommands({ category: 'help' }).some((c) => c.id === 'test.one'));
  assert.equal(reg.listCommands().at(-1).id, 'test.one');
  weg();
  assert.equal(reg.getCommand('test.one'), null);
  assert.equal(reg.unregisterCommand('test.one'), false);
});

test('duplicate id, unknown category and missing run are errors', () => {
  const weg = tijdelijk({ id: 'test.dup' });
  assert.throws(() => tijdelijk({ id: 'test.dup' }), /duplicate command id "test.dup"/);
  assert.throws(() => tijdelijk({ id: 'file.open' }), /duplicate/);
  assert.throws(() => tijdelijk({ id: 'test.cat', category: 'ribbon' }), /unknown category/);
  assert.throws(() => tijdelijk({ id: 'test.run', run: undefined }), /needs run/);
  assert.throws(() => tijdelijk({ id: 'test.lbl', label: '' }), /label/);
  weg();
});

test('runCommand passes args, respects enabled() and throws for unknown ids', () => {
  let aan = false;
  const calls = [];
  const weg = tijdelijk({ id: 'test.run', enabled: () => aan, run: (...a) => { calls.push(a); return 'ok'; } });
  assert.equal(reg.isCommandEnabled('test.run'), false);
  assert.equal(reg.runCommand('test.run', 1, 2), undefined);
  assert.deepEqual(calls, []);
  aan = true;
  assert.equal(reg.runCommand('test.run', 1, 2), 'ok');
  assert.deepEqual(calls, [[1, 2]]);
  assert.throws(() => reg.runCommand('test.nope'), /unknown command "test.nope"/);
  assert.equal(reg.isCommandEnabled('test.nope'), false);
  weg();
});

test('seed enabled() follows the active document', () => {
  state.documents = [];
  state.activeDocumentIndex = -1;
  assert.equal(reg.isCommandEnabled('file.open'), true);
  for (const id of ['file.save', 'file.print', 'view.zoomIn', 'edit.undo', 'edit.redo']) {
    assert.equal(reg.isCommandEnabled(id), false, id);
  }
  state.documents = [{ id: 'd', pdfDoc: { numPages: 1 }, undoStack: [{}], redoStack: [] }];
  state.activeDocumentIndex = 0;
  assert.equal(reg.isCommandEnabled('file.save'), true);
  assert.equal(reg.isCommandEnabled('edit.undo'), true);
  assert.equal(reg.isCommandEnabled('edit.redo'), false);
  state.documents = [];
  state.activeDocumentIndex = -1;
});

test('checked() and reactivity: memos re-run on state changes and notifyCommandsChanged', () => {
  let buiten = false;
  const weg = tijdelijk({ id: 'test.toggle', checked: () => buiten });
  assert.equal(reg.isCommandChecked('file.open'), undefined);
  createRoot((dispose) => {
    const checked = createMemo(() => reg.isCommandChecked('test.toggle'));
    const save = createMemo(() => reg.isCommandEnabled('file.save'));
    const count = createMemo(() => reg.listCommands({ category: 'help' }).length);
    assert.equal(checked(), false);
    buiten = true; // not reactive by itself
    assert.equal(checked(), false);
    reg.notifyCommandsChanged();
    assert.equal(checked(), true);
    assert.equal(save(), false);
    state.documents = [{ id: 'd', pdfDoc: {}, undoStack: [], redoStack: [] }];
    state.activeDocumentIndex = 0;
    assert.equal(save(), true, 'state store changes are tracked without notify');
    const before = count();
    const weg2 = tijdelijk({ id: 'test.later' });
    assert.equal(count(), before + 1);
    weg2();
    dispose();
  });
  state.documents = [];
  state.activeDocumentIndex = -1;
  weg();
});

test('commandLabel uses the given t, falls back to the key', () => {
  assert.equal(reg.commandLabel('file.saveAs'), 'saveAs');
  assert.equal(reg.commandLabel('view.fitPage', (k) => `<${k}>`), '<ribbon:home.fitPageLabel>');
  assert.equal(reg.commandLabel('test.none'), '');
});

test('searchCommands ranks label > keyword > id, needs every word, keeps order on ties', () => {
  const t = (k) => ({
    'test:extract': 'Extract Pages', 'test:extractText': 'Copy Text', 'test:context': 'Contextual Tab',
    'test:exp': 'Explode', 'test:ovl': 'Overlay Pages',
  })[k] ?? k;
  const weg = [
    tijdelijk({ id: 'document.extractPages', label: 'test:extract' }),
    tijdelijk({ id: 'edit.copyText', label: 'test:extractText', keywords: ['extract text'] }),
    tijdelijk({ id: 'test.context', label: 'test:context' }),
    tijdelijk({ id: 'test.extractor', label: 'test:exp' }),
    tijdelijk({ id: 'document.overlay', label: 'test:ovl' }),
  ];
  const ids = (q) => reg.searchCommands(q, { t }).map((c) => c.id);
  assert.deepEqual(ids('extract').slice(0, 3), ['document.extractPages', 'edit.copyText', 'test.extractor']);
  assert.deepEqual(ids('pages'), ['document.extractPages', 'document.overlay']);
  assert.deepEqual(ids('extract pages'), ['document.extractPages']);
  assert.deepEqual(ids('EXTRÄCT pa')[0], 'document.extractPages', 'case and accents ignored');
  assert.ok(ids('xtrct').includes('document.extractPages'), 'subsequence still matches');
  assert.deepEqual(ids('zzzz'), []);
  assert.equal(reg.searchCommands('').length, reg.listCommands().length);
  assert.equal(reg.searchCommands('', { limit: 3 }).length, 3);
  assert.equal(reg.searchCommands('extract', { t, limit: 1 })[0].id, 'document.extractPages');
  // Without t the seed label keys still match by their last segment, keywords and id.
  assert.equal(reg.searchCommands('zoom in')[0].id, 'view.zoomIn');
  assert.equal(reg.searchCommands('print')[0].id, 'file.print');
  weg.forEach((w) => w());
});
