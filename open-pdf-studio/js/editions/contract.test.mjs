import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEditionContract, EDITION_API_VERSION } from './contract.js';
import { edition as community } from './community.js';
import { NL_CATEGORIES } from '../solid/data/nlSymbolLibrary.js';
import { getTemplate } from '../symbols/registry.js';

test('Community implements the public edition API', () => {
  assert.equal(assertEditionContract(community), community);
  assert.equal(community.apiVersion, EDITION_API_VERSION);
  assert.deepEqual(community.panels, []);
  assert.deepEqual(community.symbolCategories, []);
  assert.equal(NL_CATEGORIES.some((category) => category.id === 'nl-elektra'), false);
  for (const id of ['vloer-kanaalplaatvloer', 'vloer-isolatieplaatvloer',
    'vloer-ps-isolatievloer', 'paal-aanzicht-type-1', 'paal-aanzicht-type-2']) {
    assert.equal(getTemplate(id), null, `${id} requires a reviewed edition provider`);
    assert.equal(NL_CATEGORIES.some((category) => category.symbols.some((symbol) =>
      symbol.parametricId === id)), false);
  }
});

test('incompatible composition fails before the editor starts', () => {
  assert.throws(() => assertEditionContract({ ...community, apiVersion: 2 }), /Unsupported OcuDraw edition API/);
  assert.throws(() => assertEditionContract({ ...community, panelIds: ['sample-addon-panel'] }), /panelIds/);
  assert.throws(() => assertEditionContract({ ...community, pdf: {} }), /readWorkspace/);
});
