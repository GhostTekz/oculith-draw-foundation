// Line tool: click-click and press-drag-release both end a line (the external editor).

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
register('../pdf/saver-test-hooks.mjs', import.meta.url);
register('./line-tool-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { lineTool, LINE_DRAG_COMMIT_PX } = await import('./tools/line-tool.js');

function harness(scale = 2) {
  const made = [];
  const ctx = {
    x: 0, y: 0, scale, pageNum: 1,
    snap: () => ({ snapped: false }),
    snapToGrid: v => v,
    drawShapePreview() {}, redraw() {}, drawSnapIndicator() {},
    createAnnotationFromTool: (tool, x1, y1, x2, y2) => ({ type: tool, x1, y1, x2, y2 }),
    recordAdd: ann => made.push(ann),
  };
  const ev = { button: 0, shiftKey: false };
  const down = (x, y) => { ctx.x = x; ctx.y = y; state.startX = x; state.startY = y; lineTool.onPointerDown(ctx, ev); };
  const move = (x, y) => { ctx.x = x; ctx.y = y; lineTool.onPointerMove(ctx, ev); };
  const up = (x, y) => { ctx.x = x; ctx.y = y; return lineTool.onPointerUp(ctx, ev); };
  return { ctx, made, down, move, up };
}

test.beforeEach(() => {
  state.currentTool = 'line';
  state.documents = [{ annotations: [] }];
  state.activeDocumentIndex = 0;
  state.preferences = { ...(state.preferences || {}), lineContinue: false };
  lineTool.onDeactivate({ redraw() {}, clearPolarAnchor() {} });
});

test('press, drag and release ends the line at the release point', () => {
  const h = harness();
  h.down(100, 100);
  for (let i = 1; i <= 4; i++) h.move(100 + 50 * i, 100);
  assert.equal(h.up(300, 100), true);
  assert.equal(h.made.length, 1);
  assert.deepEqual(h.made[0], { type: 'line', x1: 100, y1: 100, x2: 300, y2: 100 });
  assert.equal(state.isDrawing, false);
});

test('a release on the start point keeps click-click mode', () => {
  const h = harness();
  h.down(100, 100);
  h.up(100, 100);
  assert.equal(h.made.length, 0);
  assert.equal(state.isDrawing, true);
  h.move(180, 140);
  h.down(180, 140);
  h.up(180, 140);
  assert.equal(h.made.length, 1);
  assert.deepEqual(h.made[0], { type: 'line', x1: 100, y1: 100, x2: 180, y2: 140 });
});

test('jitter below the threshold (screen pixels) is still a click', () => {
  const h = harness(4);
  const d = (LINE_DRAG_COMMIT_PX - 1) / 4;
  h.down(50, 50);
  h.move(50 + d, 50);
  h.up(50 + d, 50);
  assert.equal(h.made.length, 0);
  assert.equal(state.isDrawing, true);
});

test('the release after the second click does not start a drag commit', () => {
  const h = harness();
  h.down(10, 10); h.up(10, 10);
  h.move(90, 10); h.down(90, 10);
  assert.equal(h.made.length, 1);
  h.move(150, 60);
  assert.equal(h.up(150, 60), false);
  assert.equal(h.made.length, 1);
});
