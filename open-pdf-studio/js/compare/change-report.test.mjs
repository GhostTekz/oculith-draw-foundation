import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCompareChangeReport, createCompareChangeReportModel, suggestedCompareReportName } from './change-report.js';

function rows(csv) {
  // These fixtures use commas and quotes in text, so parse CSV rather than
  // compare against a copy of the formatter's output.
  const result = [];
  let row = [], field = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field); field = '';
    } else if (c === '\r' && csv[i + 1] === '\n' && !quoted) {
      row.push(field); result.push(row); row = []; field = ''; i++;
    } else field += c;
  }
  return result;
}

test('report records a page pair, alignment, visual bounds, and annotation label', () => {
  const csv = buildCompareChangeReport({
    oldPath: '/plans/old, issued.pdf', newPath: '/plans/new.pdf',
    oldPage: 2, newPage: 4, offset: { dx: -12, dy: 5, rotation: 2 },
    pairing: { oldPage: 2, newPage: 4, source: 'manual', confirmedAt: '2026-10-13T19:00:00.000Z' },
    generatedAt: new Date('2026-10-13T20:00:00.000Z'),
    changes: [
      { type: 'added', x: 50, y: 20, width: 10, height: 6, detectScale: 0.8, pixelCount: 46 },
      { type: 'modified', source: 'annotation', annType: 'box', label: 'Panel "A", revised', x: 7, y: 8, width: 9, height: 10 },
    ],
  });
  const [header, visual, annotation] = rows(csv);
  assert.equal(header.length, 27);
  assert.equal(header[5], 'Page pairing status');
  assert.equal(visual.length, header.length);
  assert.equal(annotation.length, header.length);
  assert.deepEqual(visual.slice(0, 10), [
    '2026-10-13T20:00:00.000Z', '/plans/old, issued.pdf', '2', '/plans/new.pdf', '4', 'confirmed manually', '2026-10-13T19:00:00.000Z', '-12', '5', '2',
  ]);
  assert.deepEqual(visual.slice(10), ['1', 'added', 'visual', 'unreviewed', '', '50', '20', '10', '6', 'detection pixels', '0.8', '46', '62.5', '25', '12.5', '7.5', 'aligned new page']);
  assert.deepEqual(annotation.slice(10), ['2', 'modified', 'annotation', 'unreviewed', 'Panel "A", revised', '7', '8', '9', '10', 'page-view units', '', '', '7', '8', '9', '10', 'new page']);
});

test('unconfirmed pair still identifies both documents and pages without claiming sequential provenance', () => {
  const [header, row] = rows(buildCompareChangeReport({
    oldPath: 'before.pdf', newPath: 'after.pdf', oldPage: 1, newPage: 3,
    changes: [], generatedAt: new Date('2026-10-13T20:00:00.000Z'),
  }));
  assert.equal(row[1], 'before.pdf');
  assert.equal(row[3], 'after.pdf');
  assert.equal(row[4], '3');
  assert.equal(row[5], 'unconfirmed');
  assert.equal(row[6], '');
  assert.equal(row[11], 'none');
  assert.equal(row.length, header.length);
});

test('untrusted file names and annotation labels stay text in spreadsheets', () => {
  const [, row] = rows(buildCompareChangeReport({
    oldPath: '=HYPERLINK("bad")', newPath: '@SUM(1)', oldPage: 1, newPage: 1,
    changes: [{ type: 'removed', source: 'annotation', label: '+cmd\r\nnext', x: 1, y: 2, width: 3, height: 4 }],
    generatedAt: new Date('2026-10-13T20:00:00.000Z'),
  }));
  assert.equal(row[1], '\'=HYPERLINK("bad")');
  assert.equal(row[3], "'@SUM(1)");
  assert.equal(row[14], "'+cmd\r\nnext");
  assert.equal(suggestedCompareReportName('/a/old:sheet.pdf', '/b/new sheet.pdf', 1, 2), 'old_sheet-p1_vs_new_sheet-p2-changes.csv');
});

test('report refuses stale pairing provenance from another page', () => {
  const [, row] = rows(buildCompareChangeReport({
    oldPath: 'old.pdf', newPath: 'new.pdf', oldPage: 3, newPage: 7,
    pairing: { oldPage: 2, newPage: 7, source: 'manual', confirmedAt: '2026-10-13T19:00:00.000Z' },
    changes: [], generatedAt: new Date('2026-10-13T20:00:00.000Z'),
  }));
  assert.equal(row[5], 'unconfirmed');
  assert.equal(row[6], '');
});

test('review entry names its page frame and never invents page bounds without a valid detection scale', () => {
  const model = createCompareChangeReportModel({
    oldPath: 'old.pdf', newPath: 'new.pdf', oldPage: 3, newPage: 7,
    changes: [
      { type: 'removed', x: 9, y: 15, width: 6, height: 12, detectScale: 1.5 },
      { type: 'removed', source: 'annotation', x: 4, y: 5, width: 6, height: 7 },
      { type: 'added', x: 3, y: 4, width: 5, height: 6, detectScale: 0 },
    ],
  });
  assert.deepEqual(model.changes.map(change => change.pageView), [
    { x: 6, y: 10, width: 4, height: 8, frame: 'aligned new page' },
    { x: 4, y: 5, width: 6, height: 7, frame: 'old page' },
    { x: '', y: '', width: '', height: '', frame: '' },
  ]);
  const [header, ...entries] = rows(buildCompareChangeReport({
    oldPath: 'old.pdf', newPath: 'new.pdf', oldPage: 3, newPage: 7, changes: model.changes,
  }));
  assert.equal(header.length, 27);
  assert.ok(entries.every(entry => entry.length === header.length));
});
