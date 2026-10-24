// Markups List reply threads (plan-review): replies are indented child rows
// under their markup, built only while the thread is open; an inline reply
// box adds a reply as one undo step.
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../../core/state.js');
const { list, store, showList } = await import('./annotations-list.testhulp.mjs');

function openDoc(annotations) {
  state.documents = [{ id: `threads-${Math.random()}`, currentPage: 1, viewMode: 'single',
    annotations, selectedAnnotations: [] }];
  state.activeDocumentIndex = 0;
  store.setExpandedThreads(new Set());
  store.setReplyTarget(null);
}
const box = (id, replies) => ({ id, type: 'box', page: 1, x: 0, y: 0, width: 10, height: 10,
  author: 'Ann', createdAt: '2026-10-01T00:00:00Z', modifiedAt: '2026-10-01T00:00:00Z', replies });
const markupRows = () => store.items().filter(item => !item.isHeader && !item.isReply && !item.isReplyInput);

test('a closed thread shows its count but builds no reply rows', () => {
  showList();
  openDoc([box('a', [{ id: 'r1', author: 'Bo', text: 'One', createdAt: '2026-10-02T00:00:00Z' },
    { id: 'blank', author: 'Bo', text: '' }]), box('b')]);
  list.updateAnnotationsList();
  const [a, b] = markupRows();
  assert.equal(a.replyCount, 1, 'a blank placeholder reply is not counted');
  assert.equal(a.threadOpen, false);
  assert.equal(b.replyCount, 0);
  assert.equal(store.items().filter(item => item.isReply).length, 0);
});

test('an open thread lists replies oldest first right under their markup', () => {
  showList();
  openDoc([box('a', [{ id: 'late', author: 'Bo', text: 'Second', createdAt: '2026-10-03T00:00:00Z' },
    { id: 'early', author: 'Cy', text: 'First', createdAt: '2026-10-02T00:00:00Z' }]), box('b')]);
  store.toggleThread('a');
  list.updateAnnotationsList();
  const rows = store.items().filter(item => !item.isHeader);
  assert.deepEqual(rows.map(item => item.isReply ? `reply:${item.text}` : item.id), ['a', 'reply:First', 'reply:Second', 'b']);
  assert.equal(rows[1].author, 'Cy');
  assert.equal(rows[1].parentId, 'a');
  assert.equal(rows[0].threadOpen, true);
});

test('the inline reply box adds one reply with author and date, opens the thread, and undoes in one step', async () => {
  showList();
  state.defaultAuthor = 'Reviewer';
  const markup = box('a', [{ author: 'User', date: '2026-10-01T00:00:00Z', text: '' }]);
  openDoc([markup]);
  assert.equal(list.startMarkupReply('a'), true);
  const input = store.items().find(item => item.isReplyInput);
  assert.equal(input?.parentId, 'a');
  assert.equal(list.addMarkupReply('a', '   '), false, 'an empty reply is not stored');
  assert.equal(list.addMarkupReply('a', '  Looks good  '), true);
  assert.equal(markup.replies.length, 1, 'the blank placeholder is dropped');
  assert.equal(markup.replies[0].text, 'Looks good');
  assert.equal(markup.replies[0].author, 'Reviewer');
  assert.ok(!Number.isNaN(Date.parse(markup.replies[0].createdAt)));
  assert.equal(store.replyTarget(), null, 'the reply box closes');
  assert.ok(store.items().some(item => item.isReply && item.text === 'Looks good'));
  const { undo } = await import('../../core/undo-manager.js');
  await undo();
  const restored = state.documents[0].annotations.find(a => a.id === 'a');
  assert.equal(restored.replies.filter(r => r.text).length, 0);
});

test('a locked markup takes no reply', () => {
  showList();
  const markup = { ...box('a'), locked: true };
  openDoc([markup]);
  list.startMarkupReply('a');
  assert.equal(store.items().find(item => item.isReplyInput)?.locked, true);
  assert.equal(list.addMarkupReply('a', 'Nope'), false);
  assert.equal(markup.replies, undefined);
});
