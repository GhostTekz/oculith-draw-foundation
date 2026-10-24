// Markups List status: the status cell sets a status with author and time
// (one undo step), the thread lists status changes between the replies, and
// a document's own status set gives names, colours and the status filter.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { list, store, showList } = await import('./annotations-list.testhulp.mjs');
const { parseStatusLines } = await import('../../annotations/markup-status.js');

function openDoc(annotations, extra = {}) {
  state.documents = [{ id: `status-${Math.random()}`, currentPage: 1, viewMode: 'single',
    annotations, selectedAnnotations: [], ...extra }];
  state.activeDocumentIndex = 0;
  store.setExpandedThreads(new Set());
  store.replaceHiddenStatuses([]);
}
const box = (id, extra = {}) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 5, height: 5, author: 'Ann',
  createdAt: '2026-10-01T00:00:00Z', ...extra });
const row = id => store.items().find(item => !item.isHeader && !item.isReply && item.id === id);

test('the status cell records who set the status, and undo restores it', async () => {
  showList();
  state.defaultAuthor = 'Lead';
  const markup = box('a', { status: 'Accepted' });
  openDoc([markup]);
  list.updateAnnotationsList();
  assert.equal(row('a').statusKey, 'accepted', 'a capitalised status from the canvas menu is the same status');
  assert.equal(row('a').statusColor, '#22c55e');
  assert.equal(list.setMarkupStatus('a', 'rejected'), true);
  assert.equal(list.setMarkupStatus('a', 'Rejected'), false);
  assert.equal(markup.status, 'rejected');
  assert.equal(markup.statusBy, 'Lead');
  assert.deepEqual(markup.statusHistory.map(e => e.state), ['accepted', 'rejected']);
  assert.equal(row('a').statusTitle, 'Rejected');
  assert.equal(row('a').threadCount, 2);
  const { undo } = await import('../../core/undo-manager.js');
  await undo();
  assert.equal(state.documents[0].annotations[0].status, 'Accepted');
});

test('an open thread interleaves status changes and replies by time', () => {
  showList();
  openDoc([box('a', { status: 'completed', statusHistory: [
    { state: 'accepted', author: 'Bo', date: '2026-10-02T00:00:00Z' },
    { state: 'completed', author: 'Cy', date: '2026-10-04T00:00:00Z' }],
  replies: [{ id: 'r', author: 'Dee', text: 'Fixed on site', createdAt: '2026-10-03T00:00:00Z' }] })]);
  store.toggleThread('a');
  list.updateAnnotationsList();
  const thread = store.items().filter(item => item.isReply);
  assert.deepEqual(thread.map(item => `${item.isStatusEntry ? 'status' : 'reply'}:${item.author}:${item.text}`),
    ['status:Bo:Accepted', 'reply:Dee:Fixed on site', 'status:Cy:Completed']);
});

test('a locked markup keeps its status', () => {
  showList();
  const markup = box('a', { locked: true });
  openDoc([markup]);
  assert.equal(list.setMarkupStatus('a', 'accepted'), false);
  assert.equal(markup.status, undefined);
});

test('a document status set names, colours and filters its statuses', () => {
  showList();
  const set = parseStatusLines('QA', 'Open #ff0000\nNeeds RFI #00aa00');
  openDoc([box('a', { status: 'needs rfi' }), box('b', { status: 'open' }), box('c')], { markupStatusSet: set });
  list.updateAnnotationsList();
  assert.equal(row('a').statusTitle, 'Needs RFI');
  assert.equal(row('a').statusColor, '#00aa00');
  store.replaceHiddenStatuses(['needs rfi']);
  list.updateAnnotationsList();
  assert.deepEqual(store.items().filter(item => !item.isHeader).map(item => item.id), ['b', 'c']);
  store.replaceHiddenStatuses([]);
});
