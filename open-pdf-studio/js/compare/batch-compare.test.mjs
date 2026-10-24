import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runConfirmedPairBatch, summarizeBatchPairs, MAX_BATCH_PAIRS } from './batch-compare.js';
import { buildBatchCompareChangeReport } from './change-report.js';

const pair = (oldPage, newPage) => ({ oldPage, newPage, source: 'manual', confirmedAt: '2026-10-13T19:00:00.000Z' });

function csvRows(csv) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\r' && csv[i + 1] === '\n' && !quoted) { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  return rows;
}

test('runs confirmed nonsequential pairs, keeps source and alignment, and exports one combined report', async () => {
  const calls = [];
  const progress = [];
  const batch = await runConfirmedPairBatch({
    oldPath: '/plans/=before.pdf', newPath: '/plans/after.pdf', pairs: [pair(2, 7), pair(4, 9)],
    offset: { dx: 8, dy: -3, rotation: 1 },
    detectPair: async opts => {
      calls.push(opts);
      return opts.oldPage === 2 ? [{ type: 'added', x: 12, y: 8, width: 9, height: 7, pixelCount: 63, detectScale: 1 }] : [];
    },
    annotationChanges: (_old, oldPage) => oldPage === 4 ? [{ type: 'modified', source: 'annotation', label: '=revised', x: 4, y: 5, width: 6, height: 7 }] : [],
    onProgress: value => progress.push(value),
  });
  assert.deepEqual(calls.map(call => [call.oldPage, call.newPage, call.offset]), [
    [2, 7, { dx: 8, dy: -3, rotation: 1 }], [4, 9, { dx: 8, dy: -3, rotation: 1 }],
  ]);
  assert.equal(batch.completed, 2);
  assert.equal(batch.canceled, false);
  assert.deepEqual(progress.map(item => item.completed), [0, 0, 1, 1, 2]);
  const [header, first, second] = csvRows(buildBatchCompareChangeReport(batch, new Date('2026-10-13T20:00:00.000Z')));
  assert.equal(header.at(-2), 'Batch result');
  assert.deepEqual([first[2], first[4], first[5], first[6], first[11], first.at(-2)], ['2', '7', 'confirmed manually', '2026-10-13T19:00:00.000Z', 'added', 'completed']);
  assert.deepEqual([second[2], second[4], second[12], second[14], second.at(-2)], ['4', '9', 'annotation', "'=revised", 'completed']);
});

test('records a failed pair as failed, rather than falsely reporting no changes', async () => {
  const batch = await runConfirmedPairBatch({
    oldPath: 'old.pdf', newPath: 'new.pdf', pairs: [pair(1, 3), pair(2, 4)],
    detectPair: async ({ oldPage }) => {
      if (oldPage === 1) throw new Error('=render failed');
      return [];
    },
  });
  const [, failed, unchanged] = csvRows(buildBatchCompareChangeReport(batch));
  assert.deepEqual([failed[2], failed[4], failed[11], failed.at(-2), failed.at(-1)], ['1', '3', '', 'failed', "'=render failed"]);
  assert.deepEqual([unchanged[2], unchanged[4], unchanged[11], unchanged.at(-2)], ['2', '4', 'none', 'completed']);
});

test('stop takes effect after the current pair without starting another one', async () => {
  const controller = new AbortController();
  let calls = 0;
  const progress = [];
  const batch = await runConfirmedPairBatch({
    oldPath: 'old.pdf', newPath: 'new.pdf', pairs: [pair(1, 1), pair(2, 2)],
    signal: controller.signal,
    detectPair: async () => { calls++; controller.abort(); return []; },
    onProgress: value => progress.push(value),
  });
  assert.equal(calls, 1);
  assert.equal(batch.completed, 1);
  assert.equal(batch.canceled, true);
  assert.equal(progress.at(-1).result.changes.length, 0);
  assert.deepEqual(summarizeBatchPairs(batch).map(row => [row.status, row.changeCount]), [
    ['completed', 0], ['unprocessed', null],
  ]);
});

test('canceled CSV keeps zero-change, failed and unprocessed confirmed pairs distinct', async () => {
  const controller = new AbortController();
  const batch = await runConfirmedPairBatch({
    oldPath: '/plans/issued.pdf', newPath: '/plans/revised.pdf',
    pairs: [pair(1, 4), pair(2, 5), pair(3, 6)],
    offset: { dx: 7, dy: -2, rotation: 1 }, signal: controller.signal,
    detectPair: async ({ oldPage }) => {
      if (oldPage === 2) { controller.abort(); throw new Error('Cannot render page 2'); }
      return [];
    },
  });
  assert.equal(batch.canceled, true);
  assert.equal(batch.completed, 2);
  const [header, unchanged, failed, unprocessed] = csvRows(buildBatchCompareChangeReport(batch));
  assert.equal(header.at(-2), 'Batch result');
  assert.deepEqual([unchanged[2], unchanged[4], unchanged[11], unchanged.at(-2)], ['1', '4', 'none', 'completed']);
  assert.deepEqual([failed[2], failed[4], failed[11], failed.at(-2), failed.at(-1)], ['2', '5', '', 'failed', 'Cannot render page 2']);
  assert.deepEqual([unprocessed[2], unprocessed[4], unprocessed[5], unprocessed[6], unprocessed[7], unprocessed[8], unprocessed[9], unprocessed[11], unprocessed[13], unprocessed.at(-2)],
    ['3', '6', 'confirmed manually', '2026-10-13T19:00:00.000Z', '7', '-2', '1', '', '', 'unprocessed']);
  assert.equal(unprocessed.at(-1), '');
});

test('stopping during the final pair leaves a complete report', async () => {
  const controller = new AbortController();
  const batch = await runConfirmedPairBatch({
    oldPath: 'old.pdf', newPath: 'new.pdf', pairs: [pair(1, 1)], signal: controller.signal,
    detectPair: async () => { controller.abort(); return []; },
  });
  assert.equal(batch.completed, 1);
  assert.equal(batch.canceled, false);
  assert.deepEqual(summarizeBatchPairs(batch).map(row => row.status), ['completed']);
});

test('summary keeps failures, zero-change results, running and unprocessed pairs distinct', async () => {
  const pairs = [pair(1, 4), pair(2, 5), pair(3, 6), pair(4, 7)];
  const firstTwo = await runConfirmedPairBatch({
    oldPath: 'old.pdf', newPath: 'new.pdf', pairs: pairs.slice(0, 2),
    detectPair: async ({ oldPage }) => {
      if (oldPage === 2) throw new Error('Cannot render page 2');
      return [];
    },
  });
  const snapshot = { ...firstTwo, pairs };
  assert.deepEqual(summarizeBatchPairs(snapshot, pairs[2]).map(row => [row.status, row.changeCount, row.error]), [
    ['completed', 0, ''], ['failed', null, 'Cannot render page 2'],
    ['running', null, ''], ['unprocessed', null, ''],
  ]);
});

test('rejects ambiguous and excessive page maps before detection', async () => {
  let calls = 0;
  const run = pairs => runConfirmedPairBatch({ oldPath: 'old.pdf', newPath: 'new.pdf', pairs, detectPair: async () => { calls++; return []; } });
  await assert.rejects(run([pair(1, 2), pair(1, 3)]), /unique/);
  await assert.rejects(run([pair(1, 2), { ...pair(3, 4), source: 'automatic' }]), /manually confirmed/);
  await assert.rejects(run(Array.from({ length: MAX_BATCH_PAIRS + 1 }, (_, index) => pair(index + 1, index + 1))), /at most/);
  assert.equal(calls, 0);
});
