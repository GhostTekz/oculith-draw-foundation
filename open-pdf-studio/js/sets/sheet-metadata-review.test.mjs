import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySheetMetadataReview } from './sheet-metadata-review.js';

const hash = 'a'.repeat(64);
const register = { version: 1, name: 'Drawings', sheets: [
  { id: 'one', label: 'A-01', title: '', filePath: '/set.pdf', page: 1, sourceSha256: hash, history: [] },
  { id: 'two', label: 'A-02', title: '', filePath: '/set.pdf', page: 2, sourceSha256: hash, history: [] },
] };
const row = (sheetId, label, selected = true) => ({ sheetId, label, title: 'Reviewed title', selected,
  filePath: '/set.pdf', page: sheetId === 'one' ? 1 : 2, sourceSha256: hash });

test('batch review applies selected values in one new register', () => {
  const next = applySheetMetadataReview(register, [row('one', 'A-03'), row('two', 'A-04', false)]);
  assert.equal(next.sheets[0].label, 'A-03');
  assert.equal(next.sheets[0].title, 'Reviewed title');
  assert.equal(next.sheets[1], register.sheets[1]);
  assert.equal(register.sheets[0].label, 'A-01');
});

test('batch review permits an ID swap and rejects duplicate final IDs atomically', () => {
  const swapped = applySheetMetadataReview(register, [row('one', 'A-02'), row('two', 'A-01')]);
  assert.deepEqual(swapped.sheets.map(sheet => sheet.label), ['A-02', 'A-01']);
  assert.throws(() => applySheetMetadataReview(register, [row('one', 'A-02')]), /already in this set/u);
  assert.throws(() => applySheetMetadataReview(register, [row('one', 'A-03'), row('two', 'a-03')]), /already in this set/u);
  assert.deepEqual(register.sheets.map(sheet => sheet.label), ['A-01', 'A-02']);
});

test('batch review rejects stale or unverified source rows', () => {
  assert.throws(() => applySheetMetadataReview(register, [{ ...row('one', 'A-03'), sourceSha256: undefined }]), /could not be verified/u);
  assert.throws(() => applySheetMetadataReview(register, [{ ...row('one', 'A-03'), page: 2 }]), /changed/u);
  assert.throws(() => applySheetMetadataReview(register, [{ ...row('one', 'A-03'), error: 'Missing PDF' }]), /could not be verified/u);
});
