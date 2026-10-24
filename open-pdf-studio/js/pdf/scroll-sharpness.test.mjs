import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { createInflightKeyGate } from './inflight-key-gate.js';

const bron = (pad) => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('pdf-viewport no longer selects imageSmoothingQuality low from _beeldIsSnel', () => {
  const src = bron('./pdf-viewport.js');
  const quality = src.split('\n').filter((line) =>
    line.includes('imageSmoothingQuality') || line.includes('_tileQ'));
  assert.ok(quality.length >= 2);
  for (const line of quality) {
    assert.equal(line.includes('_beeldIsSnel'), false, line.trim());
    assert.equal(line.includes("'low'"), false, line.trim());
  }
  assert.match(src, /imageSmoothingQuality = 'high'/);
  assert.match(src, /tekenKwaliteit\(m\.renderScale \|\| pxPerPt, pxPerPt\)/);
});

test('a motion tile request does not cancel an in-flight region render', () => {
  const gate = createInflightKeyGate();
  const inflight = gate.begin('page|region-a');
  assert.equal(gate.busy(), true);

  // Zelfde poort als ensureTileForCurrentView({ motion: true }): niet
  // cancel() en niet begin() zolang er een verzoek loopt. begin() zou de
  // lopende key vervangen.
  if (!gate.busy()) {
    gate.cancel();
    gate.begin('page|region-b');
  }
  assert.equal(gate.isCurrent(inflight), true);
  assert.equal(gate.finish(inflight), true);
  assert.equal(gate.busy(), false);

  const next = gate.begin('page|region-b');
  assert.equal(gate.isCurrent(next), true);
  assert.equal(gate.busy(), true);
});

test('motion ensure returns before it can cancel, and asks again when the view is still open', () => {
  const src = bron('./bitmap-orchestrator.js');
  const start = src.indexOf('export async function ensureTileForCurrentView');
  assert.ok(start >= 0);
  const body = src.slice(start);
  const busyAt = body.indexOf('_tileRequests.busy()');
  const cancelAt = body.indexOf('_tileRequests.cancel()');
  assert.ok(busyAt > 0 && busyAt < cancelAt);
  assert.match(body, /if\s*\(\s*motion\s*&&\s*_tileRequests\.busy\(\)\s*\)\s*return/);
  assert.match(body, /ensureTileForCurrentView\(canvas,\s*\{\s*motion:\s*true\s*\}\)/);

  const viewport = bron('./pdf-viewport.js');
  assert.match(viewport, /ensureTileForCurrentView\(_canvas,\s*\{\s*motion:\s*true\s*\}\)/);
  assert.match(viewport, /function _scheduleTileRecheckAfterPan\(/);
  assert.match(viewport, /_vraagTegelBijBeweging\(\)/);
});

test('a covered pan prefetches the next tile and does not cancel the view tile', () => {
  const viewport = bron('./pdf-viewport.js');
  const schedule = viewport.slice(
    viewport.indexOf('function _scheduleTileRecheckAfterPan'),
    viewport.indexOf('function _vraagTegelBijBeweging'),
  );
  assert.match(schedule, /prefetchNeighborWhileCovered\(_canvas\)/);
  assert.match(schedule, /,\s*100\)/);
  const move = viewport.slice(
    viewport.indexOf('function _vraagTegelBijBeweging'),
    viewport.indexOf('export function wielPanViewport'),
  );
  assert.equal(move.includes('prefetchNeighborWhileCovered'), false);
  assert.match(move, /ensureTileForCurrentView\(_canvas,\s*\{\s*motion:\s*true\s*\}\)/);
  assert.match(move, /_scheduleTileRecheckAfterPan\(\)/);

  const src = bron('./bitmap-orchestrator.js');
  const start = src.indexOf('export async function prefetchNeighborWhileCovered');
  assert.ok(start > src.indexOf('export async function ensureTileForCurrentView'));
  const body = src.slice(start);
  const busyAt = body.indexOf('_tileRequests.busy()');
  const beginAt = body.indexOf('_tileRequests.begin(');
  assert.ok(busyAt >= 0 && busyAt < beginAt);
  assert.equal(body.includes('_tileRequests.cancel('), false);
  assert.equal(body.includes('viewport.currentTile ='), false);
  assert.match(body, /tileCacheSet\(/);
  assert.match(body, /ensureTileForCurrentView\(canvas,\s*\{\s*motion:\s*true\s*\}\)/);
});
