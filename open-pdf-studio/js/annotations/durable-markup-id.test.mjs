import assert from 'node:assert/strict';
import test from 'node:test';
import { hasDurableMarkupId, persistsDurableMarkupId, uniqueDurableMarkupId, validDurableMarkupId } from './durable-markup-id.js';

test('the PDF-local identity scope includes plain circles, lines, and arrows', () => {
  for (const type of ['box', 'circle', 'line', 'arrow']) assert.equal(hasDurableMarkupId(type), true);
  for (const type of ['wall', 'measureDistance', 'cloud', 'count']) {
    assert.equal(hasDurableMarkupId(type), false);
  }
});

test('a Circle with a present subtype key stays outside the persisted ID contract', () => {
  assert.equal(persistsDurableMarkupId({ type: 'circle' }), true);
  assert.equal(persistsDurableMarkupId({ type: 'circle', pdfCircleSubtypePresent: true,
    pdfCircleSubtype: '' }), false);
  assert.equal(persistsDurableMarkupId({ type: 'line' }), true);
});

test('PDF-local box IDs accept only bounded inert ASCII', () => {
  for (const value of ['box_17', 'phase-a', '550e8400-e29b-41d4-a716-446655440000']) {
    assert.equal(validDurableMarkupId(value), true);
  }
  for (const value of ['', '../box', 'box one', 'é', 'x'.repeat(65), {}, null]) {
    assert.equal(validDurableMarkupId(value), false);
  }
});

test('a copied or duplicated PDF identity is repaired without changing the first box', () => {
  const used = new Set(['other-annotation']);
  assert.equal(uniqueDurableMarkupId('box-a', used), 'box-a');
  assert.equal(uniqueDurableMarkupId('box-a', used, () => 'box-b'), 'box-b');
  assert.equal(uniqueDurableMarkupId('../bad', used, () => 'box-c'), 'box-c');
  assert.deepEqual([...used], ['other-annotation', 'box-a', 'box-b', 'box-c']);
});
