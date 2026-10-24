import test from 'node:test';
import assert from 'node:assert/strict';
import { statusSet, parseStatusLines, statusOptions, statusLabel, statusColor, statusHistory,
  applyStatusChange, statusKey, DEFAULT_STATUS_SET, statusLines } from './markup-status.js';

test('the default set is the external editor\'s; None always comes first', () => {
  assert.deepEqual(statusOptions(null).map(o => o.name), ['None', 'Accepted', 'Rejected', 'Completed', 'Cancelled']);
  assert.equal(statusLabel('ACCEPTED'), 'Accepted');
  assert.equal(statusColor('accepted'), '#22c55e');
  assert.equal(statusColor('none'), null);
  assert.equal(statusLabel('reviewed'), 'Reviewed', 'a status from another program keeps its name');
  assert.equal(statusColor('reviewed'), '#8b5cf6');
  assert.equal(statusKey(undefined), 'none');
});

test('a user set needs a name and distinct one-line statuses with colours', () => {
  const set = parseStatusLines(' QA ', 'Open #FF0000\nNeeds RFI #00aa00\nClosed');
  assert.deepEqual(set, { version: 1, name: 'QA', statuses: [
    { name: 'Open', color: '#ff0000' }, { name: 'Needs RFI', color: '#00aa00' }, { name: 'Closed', color: '#888888' }] });
  assert.deepEqual(statusOptions(set).map(o => o.key), ['none', 'open', 'needs rfi', 'closed']);
  assert.equal(statusLabel('needs rfi', set), 'Needs RFI');
  assert.equal(statusColor('NEEDS RFI', set), '#00aa00');
  assert.equal(parseStatusLines('', 'Open'), null, 'name required');
  assert.equal(parseStatusLines('QA', 'Open\nopen'), null, 'duplicates');
  assert.equal(parseStatusLines('QA', 'None'), null, 'None is built in');
  assert.equal(parseStatusLines('QA', ''), null);
  assert.equal(parseStatusLines('QA', 'x'.repeat(33)), null);
  assert.equal(statusSet({ version: 2, name: 'QA', statuses: [{ name: 'A', color: '#000000' }] }), null);
  assert.equal(statusSet({ version: 1, name: 'QA', statuses: [{ name: 'A', color: 'red' }] }), null);
  assert.deepEqual(parseStatusLines('QA', statusLines(set)), set, 'the editor text round-trips');
  assert.equal(statusLines(null).split('\n').length, DEFAULT_STATUS_SET.statuses.length);
});

test('each change is recorded with author and time; the first keeps an older status', () => {
  const markup = { id: 'a', status: 'accepted', statusBy: 'Old', statusAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(applyStatusChange(markup, 'Rejected', 'Bo', '2026-10-02T00:00:00.000Z'), true);
  assert.equal(applyStatusChange(markup, 'rejected', 'Bo'), false, 'no change, no entry');
  assert.equal(applyStatusChange(markup, 'none', 'Cy', '2026-10-03T00:00:00.000Z'), true);
  assert.equal(markup.status, undefined);
  assert.equal(markup.statusBy, undefined);
  assert.deepEqual(statusHistory(markup), [
    { state: 'accepted', author: 'Old', date: '2026-01-01T00:00:00.000Z' },
    { state: 'rejected', author: 'Bo', date: '2026-10-02T00:00:00.000Z' },
    { state: 'none', author: 'Cy', date: '2026-10-03T00:00:00.000Z' },
  ]);
});

test('a status set by another route without history still ends the history', () => {
  assert.deepEqual(statusHistory({ status: 'completed', statusBy: 'Pat', statusAt: '2026-10-05T00:00:00.000Z',
    statusHistory: [{ state: 'accepted', author: 'Bo', date: '2026-10-01T00:00:00.000Z' }] }).map(e => e.state),
  ['accepted', 'completed']);
  assert.deepEqual(statusHistory({}), []);
  assert.deepEqual(statusHistory({ statusHistory: [{ state: 'accepted', author: 'Bo', date: '2026-10-01T00:00:00.000Z' }] })
    .map(e => e.state), ['accepted', 'none'], 'cleared elsewhere: the history says so');
});
