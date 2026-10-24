import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildComparePlan, parseComparePlanBytes, serializeComparePlan, suggestedComparePlanName,
  COMPARE_PLAN_FORMAT, COMPARE_PLAN_VERSION, MAX_COMPARE_PLAN_BYTES,
} from './compare-plan.js';

const selected = {
  oldPath: '/plans/issued.pdf', newPath: '/plans/revised.pdf',
  oldPageCount: 3, newPageCount: 4,
};
const confirmedAt = '2026-10-13T20:00:00.000Z';
const pair = (oldPage, newPage) => ({ oldPage, newPage, source: 'manual', confirmedAt });
const bytes = value => new TextEncoder().encode(JSON.stringify(value));
const identity = { algorithm: 'SHA-256', old: 'a'.repeat(64), new: 'b'.repeat(64) };

function validPlan(fingerprints = identity) {
  return buildComparePlan({ ...selected, offset: { dx: -8, dy: 4, rotation: 1.5 },
    pairs: [pair(1, 2), pair(3, 4)], identity: fingerprints });
}

test('a saved plan round-trips local paths, counts, confirmed pairs, alignment and fingerprints', () => {
  const plan = validPlan();
  const json = serializeComparePlan(plan);
  const reopened = parseComparePlanBytes(new TextEncoder().encode(json), selected);
  assert.deepEqual(reopened, plan);
  assert.deepEqual(Object.keys(reopened), ['format', 'version', 'documents', 'alignment', 'pairs', 'identity']);
  assert.equal(reopened.format, COMPARE_PLAN_FORMAT);
  assert.equal(reopened.version, COMPARE_PLAN_VERSION);
  assert.deepEqual(reopened.identity, identity);
  assert.deepEqual(reopened.pairs.map(item => [item.oldPage, item.newPage, item.source, item.confirmedAt]),
    [[1, 2, 'manual', confirmedAt], [3, 4, 'manual', confirmedAt]]);
  assert.equal(suggestedComparePlanName('/plans/A:101.pdf', '/plans/B 101.pdf'), 'A_101_vs_B_101.ocudraw-compare.json');
  assert.equal(json.includes('data:'), false);
});

test('older path-only plans stay readable without inventing PDF fingerprints', () => {
  const legacy = validPlan(null);
  assert.equal(legacy.version, 1);
  assert.equal(Object.hasOwn(legacy, 'identity'), false);
  assert.deepEqual(parseComparePlanBytes(bytes(legacy), selected), legacy);
});

test('import rejects changed documents or page counts before any plan is applied', () => {
  const plan = validPlan();
  assert.throws(() => parseComparePlanBytes(bytes(plan), { ...selected, oldPath: '/other/issued.pdf' }), /PDFs do not match/);
  assert.throws(() => parseComparePlanBytes(bytes(plan), { ...selected, newPageCount: 5 }), /page counts do not match/);
});

test('import rejects duplicate and out-of-range matches and nonmanual provenance', () => {
  const plan = validPlan();
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, pairs: [pair(1, 2), pair(1, 3)] }), selected), /duplicates/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, pairs: [pair(1, 2), pair(2, 2)] }), selected), /duplicates/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, pairs: [pair(4, 2)] }), selected), /out of range/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, pairs: [{ ...pair(1, 2), source: 'automatic' }] }), selected), /manual confirmation/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, pairs: [{ ...pair(1, 2), confirmedAt: 'yesterday' }] }), selected), /manual confirmation/);
});

test('import rejects unsupported schema, embedded payloads, invalid alignment and oversized files', () => {
  const plan = validPlan();
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, version: 3 }), selected), /Unsupported/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, identity: { ...identity, old: 'g'.repeat(64) } }), selected), /fingerprints/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, identity: { ...identity, new: 'x' } }), selected), /fingerprints/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, identity: { ...identity, pdfBytes: 'hidden' } }), selected), /fingerprints/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, pdfBytes: 'hidden' }), selected), /file structure/);
  assert.throws(() => parseComparePlanBytes(bytes({ ...plan, alignment: { ...plan.alignment, dx: '8' } }), selected), /finite numbers/);
  assert.throws(() => parseComparePlanBytes(new Uint8Array(MAX_COMPARE_PLAN_BYTES + 1), selected), /too large/);
  assert.throws(() => parseComparePlanBytes(new TextEncoder().encode('{'), selected), /UTF-8 JSON/);
  const large = buildComparePlan({
    oldPath: '/plans/' + 'a'.repeat(4000), newPath: '/plans/' + 'b'.repeat(4000),
    oldPageCount: 5000, newPageCount: 5000, offset: { dx: 0, dy: 0, rotation: 0 },
    pairs: Array.from({ length: 5000 }, (_, index) => pair(index + 1, index + 1)), identity,
  });
  assert.throws(() => serializeComparePlan(large), /too large to save/);
});
