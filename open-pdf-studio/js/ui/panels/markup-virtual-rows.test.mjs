import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVirtualRows, virtualRowWindow } from './markup-virtual-rows.js';

test('twenty thousand rows mount only a viewport-sized slice', () => {
  const items = Array.from({ length: 20_000 }, (_, index) => ({ id: String(index) }));
  const layout = buildVirtualRows(items);
  const nearEnd = virtualRowWindow(layout, layout.total - 600, 600);
  assert.ok(nearEnd.end - nearEnd.start < 60);
  assert.equal(nearEnd.end, 20_000);
  assert.equal(nearEnd.top + 24 * (nearEnd.end - nearEnd.start) + nearEnd.bottom, layout.total);
});

test('measured reply and group heights place a distant row correctly', () => {
  const items = [
    { isHeader: true, groupKey: 'A' },
    { id: 'one' },
    { isReply: true, parentId: 'one', replyId: 'r1', date: 'today' },
    { id: 'two' },
  ];
  const measured = new Map([['reply:one:r1:today:2', 50]]);
  const layout = buildVirtualRows(items, measured);
  assert.deepEqual([...layout.offsets], [0, 24, 48, 98, 122]);
  assert.deepEqual(virtualRowWindow(layout, 98, 24, 0), { start: 3, end: 4, top: 98, bottom: 0 });
});
