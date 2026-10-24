import test from 'node:test';
import assert from 'node:assert/strict';
import { markupCsv } from './markup-csv.js';

test('markup CSV keeps full text, quotes, status and replies and folds paired corrections', () => {
  const annotations = [
    { id: 'one', page: 2, type: 'comment', subject: 'Review', status: 'accepted', author: 'A, B', text: '"Check"\n=SUM(1,2)', replies: [{ author: 'C', text: 'Done' }], createdAt: '2026-10-01', modifiedAt: '2026-10-02', layer: 'Review' },
    { id: 'parent', page: 3, type: 'caret', intent: 'Replace', text: 'new', author: 'D' },
    { id: 'child', page: 3, type: 'textStrikethrough', inReplyTo: 'parent', replyType: 'group', markedText: 'old', author: 'D' },
  ];
  const csv = markupCsv(annotations);
  assert.ok(csv.startsWith('\uFEFF"Page","Type"'));
  assert.match(csv, /"A, B"/u);
  assert.match(csv, /"""Check""\n=SUM\(1,2\)"/u);
  assert.match(csv, /"accepted"/u);
  assert.match(csv, /"C: Done"/u);
  assert.match(csv, /"old -> new"/u);
  assert.doesNotMatch(csv, /"textStrikethrough"/u);
  assert.equal(csv.split('\r\n').length, 4);
});

test('selected export includes only selected markups and guards spreadsheet formulas', () => {
  const a = { id: 'a', page: 1, type: 'comment', text: '=2+2' };
  const b = { id: 'b', page: 2, type: 'line', subject: '@cmd' };
  const csv = markupCsv([a, b], [b]);
  assert.doesNotMatch(csv, /"=2\+2"/u);
  assert.match(csv, /"'@cmd"/u);
  assert.equal(csv.split('\r\n').length, 3);
});

test('named text column uses normalized row value and guards spreadsheet formulas', () => {
  const source = { id: 'one', page: 1, type: 'comment', markupTextValue: '=HYPERLINK("x")' };
  const csv = markupCsv([source], null, 'Review phase');
  assert.match(csv, /"Review phase"/u);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/u);
  assert.doesNotMatch(markupCsv([source]), /Review phase/u);
});

test('two Text columns export independent values and guard formulas in the second', () => {
  const source = { id: 'one', page: 1, type: 'comment', markupTextValue: 'Phase A',
    markupTextValue2: '=HYPERLINK("x")' };
  const csv = markupCsv([source], null, 'Review phase', null, null, null, null, 'Inspector note');
  assert.match(csv, /"Review phase","Inspector note"/u);
  assert.match(csv, /"Phase A","'=HYPERLINK\(""x""\)"/u);
  assert.doesNotMatch(markupCsv([source], null, 'Review phase'), /Inspector note|HYPERLINK/u);
  assert.throws(() => markupCsv([source], null, 'Review phase', null, null, null, null,
    'review phase'), /different names/u);
  const number = { version: 1, name: 'Quantity' };
  const withNumber = markupCsv([{ ...source, markupNumberValue: -7.25 }], null,
    'Review phase', null, number, null, null, 'Inspector note');
  assert.match(withNumber, /"Review phase","Inspector note","Quantity"/u);
  assert.match(withNumber, /"'=HYPERLINK\(""x""\)","-7.25"/u);
});

test('measurement CSV carries displayed value with an explicit unverified status', () => {
  const annotations = [
    { id: 'distance', page: 1, type: 'measureDistance', measureText: '42 pt' },
    { id: 'area', page: 1, type: 'measureArea', measureText: '=unsafe' },
    { id: 'note', page: 1, type: 'comment', text: 'Check scale' },
  ];
  const csv = markupCsv(annotations);
  const [header, distance, area, note] = csv.slice(1).trimEnd().split('\r\n');
  assert.match(header, /"Measurement shown","Measurement status"/u);
  assert.match(distance, /"42 pt","UNVERIFIED"$/u);
  assert.match(area, /"'=unsafe","UNVERIFIED"$/u);
  assert.match(note, /"",""$/u);
  const selected = markupCsv(annotations, [annotations[0]]);
  assert.match(selected, /"42 pt","UNVERIFIED"/u);
  assert.doesNotMatch(selected, /'=unsafe|Check scale/u);
});

test('Choice export includes only a defined selected option beside the Text column', () => {
  const definition = { version: 1, name: 'Disposition', options: ['Approved', '=Review'] };
  const rows = [
    { id: 'a', page: 1, type: 'comment', markupTextValue: 'Check door', markupChoiceValue: '=Review' },
    { id: 'b', page: 1, type: 'comment', markupTextValue: 'Check wall', markupChoiceValue: 'Unlisted' },
  ];
  const csv = markupCsv(rows, null, 'Reviewer note', definition);
  assert.match(csv, /"Reviewer note","Disposition"/u);
  assert.match(csv, /"Check door","'=Review"/u);
  assert.match(csv, /"Check wall",""/u);
  assert.doesNotMatch(csv, /Unlisted/u);
});

test('second Choice labels and optional numeric values stay independent of the first Formula source', () => {
  const first = { version: 2, name: 'Rate', options: ['Standard', 'Premium'],
    numericValues: ['10', '20'] };
  const second = { version: 2, name: 'Disposition', options: ['Review', 'Approved'],
    numericValues: [null, '7.5'] };
  const formula = { version: 2, name: 'Adjusted', source: 'customChoice',
    multiplier: '2', offset: '0' };
  const rows = [{ id: 'a', page: 1, type: 'box', markupChoiceValue: 'Standard',
    markupChoiceValue2: 'Approved' }, { id: 'b', page: 1, type: 'box', markupChoiceValue2: 'Invalid' }];
  const csv = markupCsv(rows, null, '', first, null, null, formula, '', second);
  assert.match(csv, /"Rate","Disposition","Adjusted"/u);
  assert.match(csv, /"Standard","Approved","20"/u);
  assert.doesNotMatch(csv, /Invalid/u);
  const selected = markupCsv(rows, [rows[1]], '', first, null, null, formula, '', second);
  assert.doesNotMatch(selected, /Standard|Approved|20/u);
  assert.throws(() => markupCsv(rows, null, '', first, null, null, formula, '',
    { ...second, name: 'RATE' }), /different names/u);
  const formulaLike = { version: 1, name: 'Disposition', options: ['=Review'] };
  assert.match(markupCsv([{ id: 'c', page: 1, type: 'box', markupChoiceValue2: '=Review' }],
    null, '', null, null, null, null, '', formulaLike), /"'=Review"/u);
});

test('Number export keeps canonical positive, negative and zero decimals beside Text and Choice', () => {
  const choice = { version: 1, name: 'Disposition', options: ['Review'] };
  const number = { version: 1, name: 'Quantity' };
  const rows = [
    { id: 'a', page: 1, type: 'comment', markupNumberValue: -7.25, markupChoiceValue: 'Review' },
    { id: 'b', page: 1, type: 'comment', markupNumberValue: -0 },
    { id: 'c', page: 1, type: 'comment', markupNumberValue: '1e3' },
  ];
  const csv = markupCsv(rows, null, 'Reviewer note', choice, number);
  assert.match(csv, /"Reviewer note","Disposition","Quantity"/u);
  assert.match(csv, /"Review","-7.25"/u);
  assert.match(csv, /"","0"/u);
  assert.doesNotMatch(csv, /1e3|'-7\.25/u);
  const selected = markupCsv(rows, [rows[0]], 'Reviewer note', choice, number);
  assert.match(selected, /"-7.25"/u);
  assert.doesNotMatch(selected, /"0"|1e3/u);
});

test('second Number exports trusted decimals while Formula remains sourced from first Number', () => {
  const first = { version: 1, name: 'Quantity' };
  const second = { version: 1, name: 'Unit cost' };
  const formula = { version: 1, name: 'Estimate', source: 'customNumber',
    multiplier: '2', offset: '0' };
  const rows = [{ id: 'a', page: 1, type: 'box', markupNumberValue: -7.25,
    markupNumberValue2: 0.5 }, { id: 'b', page: 1, type: 'box', markupNumberValue2: 0 }];
  const csv = markupCsv(rows, null, '', null, first, null, formula, '', null, second);
  assert.match(csv, /"Quantity","Unit cost","Estimate"/u);
  assert.match(csv, /"-7.25","0.5","-14.5"/u);
  assert.match(csv, /"","0",""/u);
  assert.doesNotMatch(csv, /"'-7.25"/u);
  const selected = markupCsv(rows, [rows[1]], '', null, first, null, formula, '', null, second);
  assert.doesNotMatch(selected, /-7.25|-14.5/u);
  assert.throws(() => markupCsv(rows, null, '', null, first, null, formula, '', null,
    { version: 1, name: 'quantity' }), /different names/u);
});

test('Checkmark CSV distinguishes blank, unchecked and checked in all and selected exports', () => {
  const checkmark = { version: 1, name: 'Verified' };
  const rows = [
    { id: 'blank', page: 1, type: 'square' },
    { id: 'unchecked', page: 1, type: 'square', markupCheckmarkValue: 'unchecked' },
    { id: 'checked', page: 1, type: 'square', markupCheckmarkValue: 'checked' },
    { id: 'invalid', page: 1, type: 'square', markupCheckmarkValue: 'true' },
  ];
  const all = markupCsv(rows, null, '', null, null, checkmark).slice(1).trimEnd().split('\r\n');
  assert.match(all[0], /"Verified"$/u);
  assert.match(all[1], /""$/u);
  assert.match(all[2], /"Unchecked"$/u);
  assert.match(all[3], /"Checked"$/u);
  assert.match(all[4], /""$/u);
  const selected = markupCsv(rows, [rows[2]], '', null, null, checkmark);
  assert.match(selected, /"Checked"/u);
  assert.doesNotMatch(selected, /"Unchecked"/u);
});

test('Formula CSV exports only computed decimal results and blanks missing Number values', () => {
  const number = { version: 1, name: 'Quantity' };
  const formula = { version: 1, name: 'Estimate', source: 'customNumber', multiplier: '12.5', offset: '2' };
  const rows = [{ id: 'a', page: 1, type: 'box', markupNumberValue: -7.25 },
    { id: 'b', page: 2, type: 'box' }];
  const csv = markupCsv(rows, null, '', null, number, null, formula);
  assert.match(csv, /"Quantity","Estimate"/u);
  assert.match(csv, /"-7\.25","-88\.625"/u);
  assert.match(csv, /"",""/u);
  assert.doesNotMatch(csv, /"'-88\.625"/u);
});

test('Formula CSV retains the exact sixth decimal for large inputs', () => {
  const number = { version: 1, name: 'Quantity' };
  const formula = { version: 1, name: 'Estimate', source: 'customNumber',
    multiplier: '-0.893054', offset: '0.199466' };
  const csv = markupCsv([{ id: 'a', page: 1, type: 'box',
    markupNumberValue: '-620399897.661694' }], null, '', null, number, null, formula);
  assert.match(csv, /"-620399897\.661694","554050610\.405832"/u);
});

test('Choice-sourced Formula CSV keeps labels and exports only mapped numeric results', () => {
  const choice = { version: 2, name: 'Rate', options: ['Standard', 'Unpriced', 'Premium'],
    numericValues: ['12.5', null, '-0.893054'] };
  const formula = { version: 2, name: 'Adjusted rate', source: 'customChoice',
    multiplier: '2', offset: '0.199466' };
  const rows = [{ id: 'a', page: 1, type: 'box', markupChoiceValue: 'Standard' },
    { id: 'b', page: 1, type: 'box', markupChoiceValue: 'Unpriced' },
    { id: 'c', page: 1, type: 'box', markupChoiceValue: 'Premium' }];
  const csv = markupCsv(rows, null, '', choice, null, null, formula);
  assert.match(csv, /"Rate","Adjusted rate"/u);
  assert.match(csv, /"Standard","25\.199466"/u);
  assert.match(csv, /"Unpriced",""/u);
  assert.match(csv, /"Premium","-1\.586642"/u);
  assert.doesNotMatch(csv, /"'-1\.586642"/u);
});

test('version 3 Formula CSV reads only second Number and keeps exact six-place result', () => {
  const first = { version: 1, name: 'Quantity' };
  const second = { version: 1, name: 'Unit cost' };
  const formula = { version: 3, name: 'Extended cost', source: 'customNumber2',
    multiplier: '-0.893054', offset: '0.199466' };
  const annotations = [{ id: 'one', page: 2, type: 'box', markupNumberValue: 7,
    markupNumberValue2: '-620399897.661694' },
  { id: 'two', page: 2, type: 'box', markupNumberValue: 9 }];
  const csv = markupCsv(annotations, null, '', null, first, null, formula, '', null, second);
  assert.match(csv, /"Quantity","Unit cost","Extended cost"/u);
  assert.match(csv, /"7","-620399897\.661694","554050610\.405832"/u);
  assert.match(csv, /"9","",""/u);
});

test('reply rows follow their markup in thread order when asked for, and guard formulas', () => {
  const rows = [
    { id: 'one', page: 2, type: 'box', author: 'Ann', text: 'Clash', replies: [
      { id: 'late', author: 'Bo', text: '=cmd', createdAt: '2026-10-02T00:00:00.000Z' },
      { id: 'early', author: 'Cy', text: 'Seen', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'blank', author: 'Dee', text: '  ' }] },
    { id: 'two', page: 3, type: 'line', author: 'Ann' },
  ];
  const lines = markupCsv(rows, null, 'Phase', null, null, null, null, '', null, null, { replyRows: true })
    .slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 5, 'header, markup, two replies, markup');
  assert.match(lines[2], /^"2","Reply","","","Cy","Seen","","2026-10-01T00:00:00.000Z"/u);
  assert.match(lines[3], /^"2","Reply","","","Bo","'=cmd",""/u);
  assert.equal(lines[2].split(',').length, lines[0].split(',').length, 'reply rows fill the custom columns');
  assert.match(lines[4], /^"3","line"/u);
  assert.equal(markupCsv(rows).slice(1).trimEnd().split('\r\n').length, 3, 'default export keeps one row per markup');
});
