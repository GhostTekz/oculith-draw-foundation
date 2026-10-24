import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesMarkupSearch } from './markup-search.js';

const markup = {
  page: 2, type: 'line', subject: 'Fire protection', author: 'Ada',
  status: 'Accepted', text: 'Install sprinkler here',
};

test('Markups List search finds words across visible review fields', () => {
  assert.equal(matchesMarkupSearch(markup, 'page 2 accepted'), true);
  assert.equal(matchesMarkupSearch(markup, 'SPRINKLER ada'), true);
  assert.equal(matchesMarkupSearch(markup, 'fire protection'), true);
  assert.equal(matchesMarkupSearch(markup, 'cloud'), false);
  assert.equal(matchesMarkupSearch(markup, 'page 3'), false);
});

test('search accepts rendered correction preview and blank query', () => {
  assert.equal(matchesMarkupSearch(markup, 'replacement', 'Replacement note'), true);
  assert.equal(matchesMarkupSearch(markup, '   '), true);
  assert.equal(matchesMarkupSearch(markup, ''), true);
});

test('search matches defined custom Text values without exposing undefined columns', () => {
  assert.equal(matchesMarkupSearch(markup, 'inspected', '', ['Phase A', 'Inspected']), true);
  assert.equal(matchesMarkupSearch(markup, 'inspected', '', []), false);
});

test('search can match a defined second Choice label', () => {
  assert.equal(matchesMarkupSearch(markup, 'approved', '', ['', '', '', 'Approved']), true);
  assert.equal(matchesMarkupSearch(markup, 'approved', '', ['', '', '', '']), false);
});

test('search can match a defined second Number value', () => {
  assert.equal(matchesMarkupSearch(markup, '-7.25', '', ['', '', '', '', '', '-7.25']), true);
  assert.equal(matchesMarkupSearch(markup, '-7.25', '', []), false);
});
