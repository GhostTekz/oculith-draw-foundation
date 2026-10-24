import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { buildComparePlan } from './compare-plan.js';
import {
  COMPARE_SNAPSHOTS_KEY, MAX_COMPARE_SNAPSHOTS, comparePdfContentIdentity,
  compareSnapshotIdentityMatches, compareSnapshotMatches,
  readCompareSnapshots, removeCompareSnapshot, saveCompareSnapshot,
} from './compare-snapshots.js';

const selected = { oldPath: '/plans/issued.pdf', newPath: '/plans/revised.pdf', oldPageCount: 3, newPageCount: 4 };
const pairing = { oldPage: 1, newPage: 2, source: 'manual', confirmedAt: '2026-10-13T20:00:00.000Z' };
const plan = dx => buildComparePlan({ ...selected, offset: { dx, dy: -2, rotation: 1 }, pairs: [pairing] });
const identity = (old = 'a', newer = 'b') => ({ algorithm: 'SHA-256', old: old.repeat(64), new: newer.repeat(64) });

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('explicit local snapshots persist validated plans without PDF bytes and can be removed', () => {
  const storage = memoryStorage();
  const first = saveCompareSnapshot(plan(8), identity(), storage, '2026-10-13T21:00:00.000Z');
  assert.equal(first.length, 1);
  assert.equal(compareSnapshotMatches(first[0].plan, selected), true);
  assert.equal(compareSnapshotMatches(first[0].plan, { ...selected, newPageCount: 5 }), false);
  assert.deepEqual(readCompareSnapshots(storage), first);
  assert.deepEqual(first[0].plan.pairs, [pairing]);
  assert.deepEqual(first[0].identity, identity());
  assert.equal(storage.getItem(COMPARE_SNAPSHOTS_KEY).includes('pdfBytes'), false);
  assert.deepEqual(removeCompareSnapshot(first[0].id, storage), []);
  assert.deepEqual(readCompareSnapshots(storage), []);
});

test('saving the same setup refreshes one entry; recent history is bounded', () => {
  const storage = memoryStorage();
  const original = saveCompareSnapshot(plan(1), identity(), storage, '2026-10-13T21:00:00.000Z')[0];
  const refreshed = saveCompareSnapshot(plan(1), identity(), storage, '2026-10-13T21:01:00.000Z');
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].id, original.id);
  assert.equal(refreshed[0].savedAt, '2026-10-13T21:01:00.000Z');
  const changedContent = saveCompareSnapshot(plan(1), identity('a', 'c'), storage);
  assert.equal(changedContent.length, 2);
  assert.notEqual(changedContent[0].id, original.id);
  for (let index = 2; index <= MAX_COMPARE_SNAPSHOTS + 2; index++) saveCompareSnapshot(plan(index), identity(), storage);
  const recent = readCompareSnapshots(storage);
  assert.equal(recent.length, MAX_COMPARE_SNAPSHOTS);
  assert.equal(recent[0].plan.alignment.dx, MAX_COMPARE_SNAPSHOTS + 2);
  assert.equal(recent.some(entry => entry.plan.alignment.dx === 1), false);
});

test('corrupt or unsupported history cannot become a reviewable plan', () => {
  const storage = memoryStorage();
  storage.setItem(COMPARE_SNAPSHOTS_KEY, JSON.stringify({ format: 'ocudraw.compare-snapshots', version: 3, entries: [] }));
  assert.deepEqual(readCompareSnapshots(storage), []);
  storage.setItem(COMPARE_SNAPSHOTS_KEY, JSON.stringify({
    format: 'ocudraw.compare-snapshots', version: 1, entries: [
      { id: 'invalid', savedAt: '2026-10-13T21:00:00.000Z', plan: { ...plan(1), pairs: [{ ...pairing, source: 'automatic' }] } },
      { id: 'valid', savedAt: '2026-10-13T21:00:00.000Z', plan: plan(2) },
    ],
  }));
  const legacy = readCompareSnapshots(storage);
  assert.deepEqual(legacy.map(entry => entry.id), ['valid']);
  assert.equal(legacy[0].identity, null);
  assert.equal(compareSnapshotIdentityMatches(legacy[0].identity, identity()), false);
  assert.throws(() => saveCompareSnapshot({ ...plan(1), pdfBytes: 'hidden' }, identity(), storage), /file structure/u);
  assert.deepEqual(readCompareSnapshots(storage).map(entry => entry.id), ['valid']);
  saveCompareSnapshot(plan(1), identity(), storage);
  assert.equal(JSON.parse(storage.getItem(COMPARE_SNAPSHOTS_KEY)).version, 2);
  assert.deepEqual(readCompareSnapshots(storage).map(entry => !!entry.identity), [true, false]);
});

test('SHA-256 distinguishes same-path same-page-count replacements without storing PDF bytes', async () => {
  const oldBytes = Uint8Array.from([37, 80, 68, 70, 45, 49]);
  const revisedA = Uint8Array.from([37, 80, 68, 70, 45, 50]);
  const revisedB = Uint8Array.from([37, 80, 68, 70, 45, 51]);
  const saved = await comparePdfContentIdentity(oldBytes, revisedA, webcrypto);
  const same = await comparePdfContentIdentity(oldBytes, revisedA, webcrypto);
  const replacement = await comparePdfContentIdentity(oldBytes, revisedB, webcrypto);
  assert.equal(compareSnapshotIdentityMatches(saved, same), true);
  assert.equal(compareSnapshotIdentityMatches(saved, replacement), false);
  assert.match(saved.old, /^[0-9a-f]{64}$/u);
  assert.throws(() => saveCompareSnapshot(plan(1), { ...saved, new: 'not a hash' }, memoryStorage()), /SHA-256 fingerprint/u);
  await assert.rejects(comparePdfContentIdentity(null, revisedA, webcrypto), /loaded bytes/u);
});

test('unavailable storage reports a save failure without claiming persistence', () => {
  const unavailable = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.throws(() => saveCompareSnapshot(plan(1), identity(), unavailable), /Could not save local comparison history/u);
  assert.deepEqual(readCompareSnapshots(unavailable), []);
});
