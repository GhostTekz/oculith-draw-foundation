// Markups CSV with raceway runs: four columns (Tag, Raceway, Fittings, Bends)
// after all others, filled for runs and empty for other markups; an export
// without a run keeps exactly the columns it had.

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { invalidateScaleRegionCache } = await import('./scale-region.js');
const { createRacewayAnnotation } = await import('../tools/raceway/raceway-creator.js');
const { markupCsv, markupSummaryRows } = await import('./markup-csv.js');

state.documents = [{ id: 'csv-rw', filePath: 'C:/rw/in.pdf', pdfDoc: {}, currentPage: 1, annotations: [],
  measureScale: { pixelsPerUnit: 18, unit: 'ft' }, pageRotations: {}, _annotationPagesReady: new Set([1]), textEdits: [] }];
state.activeDocumentIndex = 0;
state.preferences.measureScale = null;
invalidateScaleRegionCache();

const BENDY = [{ x: 60, y: 60 }, { x: 420, y: 60 }, { x: 420, y: 240 },
  { x: 420 + 127.28, y: 240 + 127.28 }, { x: 420 + 127.28, y: 500 }];

const parse = (csv) => csv.replace(/^\uFEFF/u, '').trim().split('\r\n')
  .map(line => [...line.matchAll(/"((?:[^"]|"")*)"/gu)].map(m => m[1].replaceAll('""', '"')));

const comment = { id: 'c', page: 1, type: 'comment', text: 'Check', author: 'A', replies: [{ author: 'B', text: 'ok' }] };
const distance = { id: 'd', page: 1, type: 'measureDistance', measureText: '10\'-0"' };

test('raceway rows get Tag, Raceway, Fittings and Bends after the other columns', () => {
  const run = createRacewayAnnotation(BENDY, { kind: 'conduit', conduitType: 'EMT', tradeSize: '1',
    marks: { 0: 'up', 2: 'pull' }, tag: 'F-3' }, 1);
  run.id = 'rw';
  const tray = createRacewayAnnotation([{ x: 60, y: 300 }, { x: 330, y: 300 }, { x: 330, y: 480 }],
    { kind: 'tray', trayStyle: 'ladder', widthIn: 24, railIn: 4 }, 1);
  tray.id = 'tray';
  const before = parse(markupCsv([comment, distance]));
  const rows = parse(markupCsv([comment, run, distance, tray], null, '', null, null, null, null, '', null, null,
    { replyRows: true, pageLabel: (a) => `A-${a.page}` }));
  const header = rows[0];
  assert.deepEqual(header.slice(-4), ['Tag', 'Raceway', 'Fittings', 'Bends']);
  assert.deepEqual(header.slice(0, -5), before[0], 'the existing columns keep their order');
  assert.equal(header.at(-5), 'Page label');
  assert.ok(rows.every(r => r.length === header.length), 'every line has every column');
  const line = (type) => rows.find(r => r[1] === type);
  const runs = rows.filter(r => r[1] === 'measureRaceway');
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].slice(-4),
    ['F-3', '1" EMT', '1 × 90°, 1 × 45°, 1 × 90° up, 1 × pull box', '180° | 45°']);
  assert.deepEqual(runs[1].slice(-4), ['', '24" Ladder tray, 4" rail', '1 × 90°', '90°']);
  assert.deepEqual(line('comment').slice(-4), ['', '', '', '']);
  assert.deepEqual(line('Reply').slice(-4), ['', '', '', '']);
  assert.deepEqual(line('measureDistance').slice(-4), ['', '', '', '']);
  assert.equal(markupSummaryRows([run])[0].raceway.size, '1" EMT');
});

test('an export without raceway runs is unchanged', () => {
  const csv = markupCsv([comment, distance]);
  assert.doesNotMatch(csv, /"Tag"|"Raceway"|"Fittings"|"Bends"/u);
  const header = parse(csv)[0];
  assert.deepEqual(header, ['Page', 'Type', 'Subject', 'Status', 'Author', 'Text', 'Replies', 'Created', 'Modified',
    'Layer', 'Measurement shown', 'Measurement status']);
  assert.equal('raceway' in markupSummaryRows([comment])[0], false);
});
