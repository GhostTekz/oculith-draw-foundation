// PDF layer view: the override arithmetic behind the Layers panel controls,
// the remembered view per document, and the output-route policy.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  withVisibility, soloOverrides, allOverrides, sameOverrides, layerStates, layerNameMatches,
} from './native-ocg-view.js';
import {
  setLayerViewStorage, layerViewKey, rememberLayerView, recallLayerView, LAYER_VIEW_LIMIT, LAYER_VIEW_STORAGE_KEY,
} from './layer-view-memory.js';
import { LAYER_ROUTES, layerRouteDecision, confirmLayerRoute } from './layer-output-policy.js';

const groups = new Map([
  ['5R', { name: 'Architectural', defaultVisible: true }],
  ['6R', { name: 'Electrical', defaultVisible: true }],
  ['7R', { name: 'Text', defaultVisible: false }],
]);

function memoryStorage() {
  const data = new Map();
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}

test('a toggle stores only differences from the PDF default', () => {
  const hidden = withVisibility(groups, new Map(), { '5R': false });
  assert.deepEqual([...hidden], [['5R', false]]);
  // Back to the default removes the override instead of storing it.
  assert.deepEqual([...withVisibility(groups, hidden, { '5R': true })], []);
  // A default-hidden layer shown is an override too.
  assert.deepEqual([...withVisibility(groups, new Map(), new Map([['7R', true]]))], [['7R', true]]);
  assert.throws(() => withVisibility(groups, new Map(), { '99R': false }), /Unknown PDF layer/);
  assert.throws(() => withVisibility(groups, new Map(), { '5R': 'no' }), /true or false/);
});

test('show only, show all and hide all', () => {
  const solo = soloOverrides(groups, '6R');
  assert.deepEqual(Object.fromEntries(solo), { '5R': false });
  const soloText = soloOverrides(groups, '7R');
  assert.deepEqual(Object.fromEntries(soloText), { '5R': false, '6R': false, '7R': true });
  assert.deepEqual(Object.fromEntries(soloOverrides(groups, '6R', ['7R'])), { '5R': false, '7R': true });
  assert.deepEqual(Object.fromEntries(allOverrides(groups, solo, true)), { '7R': true });
  assert.deepEqual(Object.fromEntries(allOverrides(groups, new Map(), false)), { '5R': false, '6R': false });
  // Show all on a filtered subset leaves the other layers as they are.
  assert.deepEqual(Object.fromEntries(allOverrides(groups, soloText, true, ['5R'])),
    { '6R': false, '7R': true });
  assert.throws(() => soloOverrides(groups, 'nope'), /Unknown PDF layer/);
  assert.ok(sameOverrides(new Map([['5R', false]]), new Map([['5R', false]])));
  assert.ok(!sameOverrides(new Map([['5R', false]]), new Map([['5R', true]])));
});

test('panel states and the name filter', () => {
  const states = layerStates(groups, new Map([['5R', false], ['7R', true]]));
  assert.deepEqual(states.map(s => [s.id, s.visible, s.defaultVisible]),
    [['5R', false, true], ['6R', true, true], ['7R', true, false]]);
  assert.ok(layerNameMatches('E-POWER Receptacles', 'power'));
  assert.ok(layerNameMatches('anything', '  '));
  assert.ok(!layerNameMatches('A-WALL', 'power'));
});

test('a layer view is remembered per document and restored only onto matching layers', () => {
  const storage = memoryStorage();
  setLayerViewStorage(storage);
  const key = layerViewKey('C:/plans/E-101.pdf');
  assert.equal(layerViewKey(''), null);
  rememberLayerView(key, [{ id: '5R', name: 'Architectural', visible: false }, { id: '7R', name: 'Text', visible: true }]);
  assert.deepEqual(Object.fromEntries(recallLayerView(key, groups)), { '5R': false, '7R': true });
  // A different layer behind the same reference is not touched.
  const renamed = new Map(groups);
  renamed.set('5R', { name: 'Site plan', defaultVisible: true });
  assert.deepEqual(Object.fromEntries(recallLayerView(key, renamed)), { '7R': true });
  // A remembered state equal to a (new) default is no override.
  const newDefaults = new Map(groups);
  newDefaults.set('5R', { name: 'Architectural', defaultVisible: false });
  assert.deepEqual(Object.fromEntries(recallLayerView(key, newDefaults)), { '7R': true });
  // Other documents are unaffected; an empty view forgets the entry.
  assert.equal(recallLayerView(layerViewKey('C:/plans/A-101.pdf'), groups).size, 0);
  rememberLayerView(key, []);
  assert.equal(recallLayerView(key, groups).size, 0);
  assert.deepEqual(JSON.parse(storage.getItem(LAYER_VIEW_STORAGE_KEY)), {});
});

test('the remembered views are bounded and survive broken storage', () => {
  const storage = memoryStorage();
  setLayerViewStorage(storage);
  for (let i = 0; i < LAYER_VIEW_LIMIT + 5; i++) {
    rememberLayerView(`doc-${i}`, [{ id: '5R', name: 'Architectural', visible: false }], i);
  }
  const all = JSON.parse(storage.getItem(LAYER_VIEW_STORAGE_KEY));
  assert.equal(Object.keys(all).length, LAYER_VIEW_LIMIT);
  assert.ok(!('doc-0' in all) && `doc-${LAYER_VIEW_LIMIT + 4}` in all);
  storage.setItem(LAYER_VIEW_STORAGE_KEY, '{not json');
  assert.equal(recallLayerView('doc-9', groups).size, 0);
  setLayerViewStorage({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.doesNotThrow(() => rememberLayerView('doc', [{ id: '5R', name: 'Architectural', visible: false }]));
  assert.equal(recallLayerView('doc', groups).size, 0);
  setLayerViewStorage(memoryStorage());
});

test('every output route has a decision, and only refusing routes ask', () => {
  for (const [route, entry] of Object.entries(LAYER_ROUTES)) {
    assert.ok(['honours', 'refuses', 'unaffected'].includes(entry.behaviour), route);
    assert.deepEqual(layerRouteDecision(route, false), { action: 'continue' });
    const changed = layerRouteDecision(route, true);
    if (entry.behaviour === 'refuses') {
      assert.equal(changed.action, 'ask', route);
      assert.ok(changed.options.includes('reset') && changed.options.includes('cancel'), route);
      assert.equal(changed.options.includes('raster'), !!entry.raster, route);
    } else {
      assert.deepEqual(changed, { action: 'continue' }, route);
    }
  }
  for (const route of ['display', 'thumbnails', 'print', 'image-export', 'raster-pdf-export', 'snap-geometry']) {
    assert.equal(LAYER_ROUTES[route].behaviour, 'honours', route);
  }
  assert.equal(LAYER_ROUTES.save.behaviour, 'unaffected');
  assert.equal(LAYER_ROUTES['cad-export'].behaviour, 'refuses');
  assert.equal(LAYER_ROUTES['cad-export'].raster, false);
  assert.throws(() => layerRouteDecision('teleport', true), /Unknown output route/);
});

test('a refusing route resets, exports raster or cancels as the user chooses', async () => {
  const doc = {};
  let overrides = [{ object_number: 5, generation: 0, visible: false }];
  const selection = {
    nativeOcgSelectionForDocument: () => ({ ocgVisibility: overrides, revision: 1 }),
    resetNativeOcgSelection: async () => { overrides = []; },
  };
  const asked = [];
  const ask = (choice) => async (question) => { asked.push(question); return choice; };
  assert.equal(await confirmLayerRoute(doc, 'extract-pages', { selection, ask: ask('cancel') }), 'cancel');
  assert.equal(overrides.length, 1, 'cancel keeps the view');
  assert.equal(await confirmLayerRoute(doc, 'extract-pages', { selection, ask: ask('raster') }), 'raster');
  // CAD export has no raster alternative: a raster answer is a cancel.
  assert.equal(await confirmLayerRoute(doc, 'cad-export', { selection, ask: ask('raster') }), 'cancel');
  assert.deepEqual(asked.map(q => q.options), [
    ['reset', 'raster', 'cancel'], ['reset', 'raster', 'cancel'], ['reset', 'cancel'],
  ]);
  assert.equal(await confirmLayerRoute(doc, 'pdfx-export', { selection, ask: ask('reset') }), 'continue');
  assert.equal(overrides.length, 0, 'reset returned the layers to the PDF default');
  // Nothing to ask once the view is the default, and never for honouring routes.
  asked.length = 0;
  assert.equal(await confirmLayerRoute(doc, 'cad-export', { selection, ask: ask('cancel') }), 'continue');
  overrides = [{ object_number: 5, generation: 0, visible: false }];
  assert.equal(await confirmLayerRoute(doc, 'print', { selection, ask: ask('cancel') }), 'continue');
  assert.equal(asked.length, 0);
});
