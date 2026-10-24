// Tool Chest sequences: label pattern, per-document counter, and stamping
// the label into a placed markup. The PDF reopen path is covered by
// js/pdf/tool-sequences-roundtrip.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanSequence, formatSequenceLabel, nextSequenceValue, setNextSequenceValue, takeSequenceLabel,
  stampSequenceLabel, sequenceCountersToList, sequenceCountersFromList, SEQUENCE_LIMITS,
} from './tool-sequences.js';

const doors = { prefix: 'D-', suffix: '', start: 1, step: 1, digits: 2 };

test('a sequence pattern is validated and formats prefix, padded number, and suffix', () => {
  assert.deepEqual(cleanSequence(doors), doors);
  assert.deepEqual(cleanSequence({ start: 5, step: 5, digits: 3 }), { prefix: '', suffix: '', start: 5, step: 5, digits: 3 });
  for (const bad of [null, [], { ...doors, step: 0 }, { ...doors, digits: 7 }, { ...doors, start: -1 },
    { ...doors, start: 1.5 }, { ...doors, prefix: 'x'.repeat(17) }, { ...doors, prefix: 'a\nb' },
    { ...doors, author: 'PRIVATE' }, { ...doors, step: '1' }]) {
    assert.equal(cleanSequence(bad), null, JSON.stringify(bad));
  }
  assert.equal(formatSequenceLabel(doors, 1), 'D-01');
  assert.equal(formatSequenceLabel(doors, 123), 'D-123', 'more digits than the padding stay whole');
  assert.equal(formatSequenceLabel({ ...doors, suffix: '/A', digits: 1 }, 7), 'D-7/A');
});

test('each placement takes the next value of its document; documents and affixes count apart', () => {
  const docA = {};
  const docB = {};
  assert.equal(nextSequenceValue(docA, doors), 1);
  assert.deepEqual([1, 2, 3].map(() => takeSequenceLabel(docA, doors)), ['D-01', 'D-02', 'D-03']);
  assert.equal(takeSequenceLabel(docB, doors), 'D-01', 'another document starts again');
  const byTwo = { ...doors, start: 10, step: 2, digits: 3 };
  assert.equal(takeSequenceLabel(docA, byTwo), 'D-004', 'same prefix and suffix share the counter');
  assert.equal(takeSequenceLabel(docA, doors), 'D-06', 'the step of the placing tool advances it');
  const windows = { prefix: 'W', suffix: '', start: 100, step: 10, digits: 1 };
  assert.deepEqual([takeSequenceLabel(docA, windows), takeSequenceLabel(docA, windows)], ['W100', 'W110']);
  assert.equal(setNextSequenceValue(docA, doors, 40), true);
  assert.equal(takeSequenceLabel(docA, doors), 'D-40');
  assert.equal(setNextSequenceValue(docA, doors, doors.start), true, 'reset');
  assert.equal(takeSequenceLabel(docA, doors), 'D-01');
  assert.equal(setNextSequenceValue(docA, doors, -3), false);
  assert.equal(setNextSequenceValue(docA, doors, SEQUENCE_LIMITS.maxValue + 1), false);
});

test('the label goes into the text of text markups and the subject of every markup', () => {
  assert.deepEqual(stampSequenceLabel({ type: 'textbox', text: '' }, 'D-01'), { type: 'textbox', text: 'D-01', subject: 'D-01' });
  assert.deepEqual(stampSequenceLabel({ type: 'callout' }, 'D-02'), { type: 'callout', text: 'D-02', subject: 'D-02' });
  assert.deepEqual(stampSequenceLabel({ type: 'textbox', text: 'Fire door' }, 'D-03'),
    { type: 'textbox', text: 'D-03 Fire door', subject: 'D-03' }, 'Drawing Mode display text follows the label');
  assert.deepEqual(stampSequenceLabel({ type: 'count', number: 4 }, 'D-04'), { type: 'count', number: 4, subject: 'D-04' });
  assert.deepEqual(stampSequenceLabel({ type: 'stamp', stampText: 'APPROVED' }, 'S1'),
    { type: 'stamp', stampText: 'APPROVED', subject: 'S1' });
});

test('catalog counters keep only affixes and numbers and reject malformed entries', () => {
  const doc = {};
  takeSequenceLabel(doc, doors);
  takeSequenceLabel(doc, { prefix: 'W', suffix: '-x', start: 7, step: 1, digits: 1 });
  const list = sequenceCountersToList(doc.toolSequences);
  assert.deepEqual(list, [{ prefix: 'D-', suffix: '', next: 2 }, { prefix: 'W', suffix: '-x', next: 8 }]);
  assert.deepEqual(sequenceCountersFromList(list), doc.toolSequences);
  assert.deepEqual(sequenceCountersFromList([{ prefix: 'D-', suffix: '', next: -1 }, { prefix: 1, suffix: '', next: 2 },
    { prefix: 'x'.repeat(40), suffix: '', next: 2 }, 'junk', null]), {});
  assert.deepEqual(sequenceCountersFromList('not a list'), {});
});
