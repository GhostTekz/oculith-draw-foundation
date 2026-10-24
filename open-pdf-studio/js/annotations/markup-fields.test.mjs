import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldColumnDefined, fieldValue, onMarkupFieldEdit, runMarkupFieldHooks } from './markup-fields.js';

const doc = {
  markupTextColumnName: 'Group',
  markupChoiceColumn: { version: 1, name: 'Kind', options: ['Straight', 'Bend'] },
  markupNumberColumn: { version: 1, name: 'Length (ft)' },
};

test('list edits follow the same rules as the Columns menu', () => {
  assert.equal(fieldValue(doc, 'markupTextValue', 'A2'), 'A2');
  assert.equal(fieldValue(doc, 'markupTextValue', 'two\nlines'), undefined);
  assert.equal(fieldValue(doc, 'markupChoiceValue', 'Bend'), 'Bend');
  assert.equal(fieldValue(doc, 'markupChoiceValue', 'Elbow'), undefined, 'only a defined option');
  assert.equal(fieldValue(doc, 'markupChoiceValue', ''), '');
  assert.equal(fieldValue(doc, 'markupNumberValue', ' 12.5 '), 12.5);
  assert.equal(fieldValue(doc, 'markupNumberValue', '12,5'), undefined);
  assert.equal(fieldValue(doc, 'markupNumberValue', ''), null, 'empty clears');
  assert.equal(fieldValue(doc, 'text', 'C1-01'), 'C1-01');
  assert.equal(fieldColumnDefined(doc, 'markupNumberValue2'), false, 'no second number column');
  assert.equal(fieldColumnDefined(doc, 'text'), true);
});

test('edit hooks run with the edited markup and can be removed', () => {
  const seen = [];
  const off = onMarkupFieldEdit((ann, field, value) => seen.push([ann.id, field, value]));
  runMarkupFieldHooks({ id: 'a' }, 'status', 'installed', doc);
  off();
  runMarkupFieldHooks({ id: 'b' }, 'status', 'x', doc);
  assert.deepEqual(seen, [['a', 'status', 'installed']]);
});
