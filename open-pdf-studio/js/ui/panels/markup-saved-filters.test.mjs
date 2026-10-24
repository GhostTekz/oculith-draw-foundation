import test from 'node:test';
import assert from 'node:assert/strict';
import { addSavedFilter, normalizeSavedFilters, readSavedFilters, writeSavedFilters } from './markup-saved-filters.js';

test('a named filter survives storage and retains search, page scope and hidden statuses', () => {
  const storage = new Map();
  const browserStorage = {
    getItem: key => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
  };
  const added = addSavedFilter([], ' Open issues ', {
    searchQuery: 'sealant', filterMode: 'current', hiddenStatuses: ['accepted', 'completed'],
  });
  assert.equal(added.error, undefined);
  assert.equal(writeSavedFilters(added.filters, browserStorage), true);
  assert.deepEqual(readSavedFilters(browserStorage), [{
    name: 'Open issues', searchQuery: 'sealant', filterMode: 'current',
    hiddenStatuses: ['accepted', 'completed'],
  }]);
  assert.match(addSavedFilter(added.filters, 'open ISSUES', {}).error, /already exists/);
});

test('corrupt or unavailable storage cannot inject unknown filter values', () => {
  const storage = { getItem: () => JSON.stringify([
    { name: ' Review ', searchQuery: 42, filterMode: 'else', hiddenStatuses: ['accepted', '<img onerror>', 42, 'x'.repeat(33), 'Accepted', 'accepted', 'needs rfi'] },
    { name: 'review', searchQuery: 'duplicate' },
    { name: '' },
  ]) };
  assert.deepEqual(readSavedFilters(storage), [{
    name: 'Review', searchQuery: '', filterMode: 'all', hiddenStatuses: ['accepted', 'needs rfi'],
  }]);
  assert.deepEqual(normalizeSavedFilters({}), []);
  assert.deepEqual(readSavedFilters({ getItem: () => '{' }), []);
  assert.equal(writeSavedFilters([], { setItem: () => { throw Error('blocked'); } }), false);
});

test('a saved filter keeps column header filters and drops unknown columns', () => {
  const added = addSavedFilter([], 'MEP open', { searchQuery: '', filterMode: 'all', hiddenStatuses: [],
    columnFilters: { author: ['Bo', 'Bo', 7], layer: [''], bogus: ['x'], status: [] } });
  assert.deepEqual(added.filters[0].columnFilters, { author: ['Bo'], layer: [''] });
  assert.equal('columnFilters' in normalizeSavedFilters([{ name: 'Old' }])[0], false);
});
