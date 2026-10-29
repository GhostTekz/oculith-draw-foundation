import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAddonListGroups } from './addon-list-groups.js';
import { composeAddons } from '../../editions/compose-addons.js';
import { edition as foundation } from '../../editions/community.js';

const id = 'sample.tools';
const group = `addon:${id}:zone`;
const row = { id: 'a', groupId: null };
const other = { id: 'b', groupId: null };
const contribution = (paths, select = () => {}) => ({ id, paths: () => paths, select });

test('v2 package grouping composes; v1 and malformed fields are rejected independently', () => {
  const good = { id, addon: { apiVersion: 2, id, listGrouping: {
    paths: () => new Map(), select: () => {},
  } } };
  const result = composeAddons(foundation, [good, {
    id: 'bad', addon: { apiVersion: 1, id: 'bad', listGrouping: good.addon.listGrouping },
  }, {
    id: 'bad-shape', addon: { apiVersion: 2, id: 'bad-shape', listGrouping: { paths: () => new Map() } },
  }]);
  assert.deepEqual(result.accepted, [id]);
  assert.deepEqual(result.rejected.map((entry) => entry.id), ['bad', 'bad-shape']);
  assert.equal(result.edition.listGroupings[0].id, id);
});

test('package groups only listed annotations with owned, bounded row descriptions', () => {
  const select = () => {};
  const paths = new Map([[row, { id: group, name: 'Zone', color: '#abc' }]]);
  const result = collectAddonListGroups([contribution(paths, select)], {}, [row, other]);
  assert.equal(result.paths.get(row).name, 'Zone');
  assert.equal(result.owners.get(group), select);
  assert.equal(result.paths.has(other), false);
  for (const bad of [
    new Map([[{}, { id: group, name: 'Zone' }]]),
    new Map([[row, { id: 'zone', name: 'Zone' }]]),
    new Map([[row, { id: group, name: 'Z'.repeat(161) }]]),
    new Map([[row, { id: group, name: 'Zone', color: 'url(x)' }]]),
    new Map([[row, { id: group, name: 'Zone', hideDominant: 'yes' }]]),
    new Map([[row, { id: group, name: 'Zone' }], [other, { id: group, name: 'Different' }]]),
    {},
  ]) {
    assert.equal(collectAddonListGroups([contribution(bad)], {}, [row, other]).paths.size, 0);
  }
});

test('full edition and earlier packages retain ownership on conflicts', () => {
  const original = { id: 'edition:zone', name: 'Edition zone' };
  const same = { id: group, name: 'Package zone' };
  const first = contribution(new Map([[row, same], [other, same]]));
  const second = { id: 'sample.other', paths: () => new Map([[other, {
    id: 'addon:sample.other:zone', name: 'Other zone',
  }]]), select: () => {} };
  const result = collectAddonListGroups([first, second], {}, [row, other],
    new Map([[row, original]]), (key) => key === original.id);
  assert.equal(result.paths.get(row), original);
  assert.equal(result.paths.get(other).name, 'Package zone');
  assert.equal(result.owners.has(group), true);
  assert.equal(collectAddonListGroups([first], {}, [row, other], null,
    (key) => key === group).paths.size, 0);
  const native = { id: 'c', groupId: 'outer', groupPath: [{ id: 'outer' }, { id: group }] };
  assert.equal(collectAddonListGroups([contribution(new Map([[row, same]]))], {}, [row, native]).paths.size,
    0, 'a package cannot impersonate a nested editor group');
});
