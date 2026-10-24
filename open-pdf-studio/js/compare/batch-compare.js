export const MAX_BATCH_PAIRS = 100;

// A batch is a snapshot of manually confirmed matches. Running sequentially
// bounds PDF raster memory and lets the browser paint progress between pages.
export async function runConfirmedPairBatch({
  oldPath, newPath, pairs, offset, detectPair, annotationChanges = () => [],
  signal, onProgress = () => {},
}) {
  if (!oldPath || !newPath) throw new Error('Select both comparison documents.');
  if (!Array.isArray(pairs) || !pairs.length) throw new Error('Confirm at least one page match.');
  if (pairs.length > MAX_BATCH_PAIRS) throw new Error(`A batch supports at most ${MAX_BATCH_PAIRS} page matches.`);
  if (typeof detectPair !== 'function') throw new Error('A change detector is required.');
  const seenOld = new Set();
  const seenNew = new Set();
  const snapshot = pairs.map(pair => {
    if (pair?.source !== 'manual' || !Number.isInteger(pair.oldPage) || pair.oldPage < 1
        || !Number.isInteger(pair.newPage) || pair.newPage < 1
        || seenOld.has(pair.oldPage) || seenNew.has(pair.newPage)) {
      throw new Error('Batch review requires unique, manually confirmed page matches.');
    }
    seenOld.add(pair.oldPage);
    seenNew.add(pair.newPage);
    return { oldPage: pair.oldPage, newPage: pair.newPage, source: 'manual', confirmedAt: pair.confirmedAt };
  });
  const alignment = { dx: offset?.dx || 0, dy: offset?.dy || 0, rotation: offset?.rotation || 0 };
  const results = [];
  const failures = [];
  let completed = 0;
  onProgress({ completed, total: snapshot.length, pair: null });
  for (const pair of snapshot) {
    if (signal?.aborted) break;
    // Let progress and Cancel render before starting the next PDF raster.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (signal?.aborted) break;
    onProgress({ completed, total: snapshot.length, pair });
    let result = null;
    let failure = null;
    try {
      const visual = await detectPair({ oldPath, newPath, oldPage: pair.oldPage, newPage: pair.newPage, offset: alignment, scale: 1.5 });
      const annotations = annotationChanges(oldPath, pair.oldPage, newPath, pair.newPage);
      result = { pair, changes: [...visual, ...annotations] };
      results.push(result);
    } catch (error) {
      failure = { pair, error: error?.message || String(error) };
      failures.push(failure);
    }
    completed++;
    onProgress({ completed, total: snapshot.length, pair: null, result, failure });
  }
  return { oldPath, newPath, offset: alignment, pairs: snapshot, results, failures, completed, canceled: !!signal?.aborted && completed < snapshot.length, completedAt: new Date().toISOString() };
}

// Keep all confirmed pairs in the review list, including pairs that never
// started after Stop. A failed pair must never appear as a zero-change result.
export function summarizeBatchPairs(batch, runningPair = null) {
  if (!batch || !Array.isArray(batch.pairs)) return [];
  const key = pair => `${pair.oldPage}:${pair.newPage}`;
  const results = new Map((batch.results || []).map(item => [key(item.pair), item]));
  const failures = new Map((batch.failures || []).map(item => [key(item.pair), item]));
  return batch.pairs.map(pair => {
    const result = results.get(key(pair));
    const failure = failures.get(key(pair));
    if (failure) return { pair, status: 'failed', changeCount: null, error: failure.error };
    if (result) return { pair, status: 'completed', changeCount: result.changes.length, error: '' };
    if (runningPair && key(pair) === key(runningPair)) return { pair, status: 'running', changeCount: null, error: '' };
    return { pair, status: 'unprocessed', changeCount: null, error: '' };
  });
}
