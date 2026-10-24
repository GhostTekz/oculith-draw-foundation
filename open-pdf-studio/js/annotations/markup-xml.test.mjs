import test from 'node:test';
import assert from 'node:assert/strict';
import { markupSummaryRows, markupCsv } from './markup-csv.js';
import { markupSummaryXml } from './markup-xml.js';
import { edition } from '../editions/active.js';
import { applyStatusChange } from './markup-status.js';

// Tags balance, attributes are quoted and every & starts an entity.
function assertWellFormed(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  const stack = [];
  for (const [, close, name, attrs, selfClose] of xml.slice(38).matchAll(/<(\/?)([A-Za-z]+)([^<>]*?)(\/?)>/gu)) {
    assert.doesNotMatch(attrs, /=[^"]/u, `unquoted attribute in <${name}>`);
    if (selfClose) continue;
    if (close) assert.equal(stack.pop(), name);
    else stack.push(name);
  }
  assert.deepEqual(stack, []);
  assert.doesNotMatch(xml.replace(/&(amp|lt|gt|quot|#10);/gu, ''), /&/u);
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u);
}

const markups = () => {
  const box = { id: 'a', page: 2, type: 'box', subject: 'Clash <A&B>', author: 'Ann "Lead"', text: 'Line 1\nLine 2\u0007',
    layer: 'l1', markupTextValue: 'Phase 2', createdAt: '2026-10-01T00:00:00.000Z',
    replies: [{ id: 'r', author: 'Bo', text: 'See <detail>', createdAt: '2026-10-02T00:00:00.000Z' }] };
  applyStatusChange(box, 'accepted', 'Bo', '2026-10-03T00:00:00.000Z');
  applyStatusChange(box, 'completed', 'Cy', '2026-10-04T00:00:00.000Z');
  return [box, { id: 'm', page: 3, type: 'measureDistance', measureText: '12 ft', author: 'Dee' }];
};

test('the XML summary carries the same rows as CSV and PDF, escaped and well formed', () => {
  const annotations = markups();
  const rows = markupSummaryRows(annotations, null, null, null, null, null, null, null,
    { layerName: () => 'MEP review' });
  const xml = markupSummaryXml({ sourcePath: 'C:/plans/A&B.pdf', rows, customTextColumn: 'Phase',
    generatedAt: new Date('2026-10-14T00:00:00Z') });
  assertWellFormed(xml);
  assert.ok(xml.includes(`<MarkupSummary generator="${edition.productName}" source="C:/plans/A&amp;B.pdf" generated="2026-10-14T00:00:00.000Z" count="2" statusHistory="all">`));
  assert.match(xml, /<Markup index="1" page="2" pageLabel="2" type="box" subject="Clash &lt;A&amp;B&gt;" status="completed" author="Ann &quot;Lead&quot;" layer="MEP review" created="2026-10-01T00:00:00.000Z"/u);
  assert.match(xml, /<Text>Line 1\nLine 2<\/Text>/u, 'control characters are dropped');
  assert.match(xml, /<Column name="Phase" kind="text">Phase 2<\/Column>/u);
  assert.match(xml, /<Status state="Accepted" author="Bo" date="2026-10-03T00:00:00.000Z"\/>\n\s*<Status state="Completed" author="Cy"/u);
  assert.match(xml, /<Reply author="Bo" date="2026-10-02T00:00:00.000Z">See &lt;detail&gt;<\/Reply>/u);
  assert.match(xml, /<Measurement status="UNVERIFIED">12 ft<\/Measurement>/u);
  assert.equal((xml.match(/<Markup /gu) || []).length, rows.length);
});

test('latest status only keeps the last change in XML, CSV and the rows', () => {
  const annotations = markups();
  const rows = markupSummaryRows(annotations, null, null, null, null, null, null, null, { latestStatusOnly: true });
  assert.deepEqual(rows[0].statusHistory.map(entry => entry.label), ['Completed']);
  const xml = markupSummaryXml({ rows, latestStatusOnly: true });
  assertWellFormed(xml);
  assert.doesNotMatch(xml, /state="Accepted"/u);
  assert.match(xml, /statusHistory="latest"/u);
  const csv = markupCsv(annotations, null, '', null, null, null, null, '', null, null,
    { statusHistory: true, latestStatusOnly: true });
  assert.match(csv.split('\r\n')[0], /"Latest status"$/u);
  assert.match(csv, /"Completed by Cy 2026-10-04T00:00:00.000Z"/u);
  assert.doesNotMatch(csv, /Accepted by/u);
  const full = markupCsv(annotations, null, '', null, null, null, null, '', null, null, { statusHistory: true });
  assert.match(full, /"Accepted by Bo 2026-10-03T00:00:00.000Z; Completed by Cy 2026-10-04T00:00:00.000Z"/u);
});

test('summary rows can follow the list order instead of the document order', () => {
  const [a, b] = markups();
  assert.deepEqual(markupSummaryRows([a, b], [b, a], null, null, null, null, null, null, { inListOrder: true })
    .map(row => row.page), [3, 2]);
  assert.deepEqual(markupSummaryRows([a, b], [b, a]).map(row => row.page), [2, 3]);
});
