// Raceway schedule: rows per run tag and size (or size alone when untagged)
// with the run count, the developed length in feet at 1/4" = 1'-0", the
// fittings by angle, pull boxes, risers and drops, and for conduit the worst
// pull section and the over-360° flag. Mixed or uncalibrated units never give
// a physical total. The placed table has the legend's table shape.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { installeerCanvas } = await import('../pdf/tekstvak-canvas.testhulp.mjs');
installeerCanvas();
const { state } = await import('../core/state.js');
const { formatMeasurement } = await import('../annotations/measurement.js');
const { invalidateScaleRegionCache } = await import('../annotations/scale-region.js');
const { createRacewayAnnotation } = await import('../tools/raceway/raceway-creator.js');
const { racewaySchedule, racewayLengthText, racewayBendText, racewayScheduleTable, isRaceway } =
  await import('./raceway-schedule.js');

state.preferences.measureRounding = 'none';
const QUARTER_INCH = { pixelsPerUnit: 18, unit: 'ft' }; // 1/4" = 1'-0"

function useScale(measureScale) {
  state.documents = [{ id: `rws-${Math.random()}`, filePath: 'C:/rws/in.pdf', pdfDoc: {}, currentPage: 1,
    annotations: [], measureScale, pageRotations: {}, _annotationPagesReady: new Set([1, 2]), textEdits: [] }];
  state.activeDocumentIndex = 0;
  state.preferences.measureScale = null;
  invalidateScaleRegionCache();
}

const straight = (y, len) => [{ x: 60, y }, { x: 60 + len, y }];
const conduit = (pts, extra = {}, page = 1) =>
  createRacewayAnnotation(pts, { kind: 'conduit', conduitType: 'EMT', tradeSize: '3/4', ...extra }, page);
const ladder = (pts, page = 1) => createRacewayAnnotation(pts, { kind: 'tray', trayStyle: 'ladder', widthIn: 24, railIn: 4 }, page);

// 90°, then 45° and 45° (bends 180°), as in raceway-roundtrip.test.mjs.
const BENDY = [{ x: 60, y: 60 }, { x: 420, y: 60 }, { x: 420, y: 240 },
  { x: 420 + 127.28, y: 240 + 127.28 }, { x: 420 + 127.28, y: 500 }];
// Five 90° corners: 450° of bends in one pull.
const STAIRS = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 },
  { x: 200, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 300 }];

test('rows group by tag and size, untagged runs by size; lengths add up in feet', () => {
  useScale(QUARTER_INCH);
  const anns = [
    conduit(straight(60, 360), { tag: 'F-1' }),          // 20 ft
    conduit(straight(100, 180), { tag: 'F-1' }),         // 10 ft
    conduit(straight(140, 90), {}, 2),                   // 5 ft, untagged, page 2
    conduit(straight(180, 90), { tag: 'F-10' }),         // 5 ft
    ladder(straight(220, 270)),                          // 15 ft
    { type: 'measureDistance', page: 1, measureValue: 3, measureUnit: 'ft', subject: '3/4" EMT' },
  ];
  assert.ok(anns.slice(0, 5).every(isRaceway) && !isRaceway(anns[5]));
  const rows = racewaySchedule(anns);
  assert.deepEqual(rows.map(r => [r.tag, r.size, r.kind, r.count, racewayLengthText(r, formatMeasurement)]), [
    ['F-1', '3/4" EMT', 'conduit', 2, '30\'-0"'],
    ['F-10', '3/4" EMT', 'conduit', 1, '5\'-0"'],
    ['', '3/4" EMT', 'conduit', 1, '5\'-0"'],
    ['', '24" Ladder tray, 4" rail', 'tray', 1, '15\'-0"'],
  ]);
  assert.deepEqual(rows[0].total, { value: 30, unit: 'ft', calibrated: true });
  assert.equal(rows[0].ids.length, 2);
  const page1 = racewaySchedule(anns, { page: 1 });
  assert.deepEqual(page1.map(r => r.tag || r.size), ['F-1', 'F-10', '24" Ladder tray, 4" rail']);
  assert.equal(rows[3].bendMax, null, 'tray has no NEC bend count');
});

test('mixed units and uncalibrated runs give no physical total', () => {
  useScale(QUARTER_INCH);
  const inFeet = conduit(straight(60, 360), { tag: 'M' });
  useScale({ pixelsPerUnit: 72, unit: 'm' });
  const inMetres = conduit(straight(100, 72), { tag: 'M' });
  useScale(null);
  const raw1 = conduit(straight(140, 300), { tag: 'U' });
  const raw2 = conduit(straight(180, 150), { tag: 'U' });
  const rawWithFeet = conduit(straight(220, 90), { tag: 'X' });
  useScale(QUARTER_INCH);
  const feetWithRaw = conduit(straight(260, 90), { tag: 'X' });
  assert.equal(raw1.measureCalibrated, false);
  const rows = racewaySchedule([inFeet, inMetres, raw1, raw2, rawWithFeet, feetWithRaw]);
  const by = Object.fromEntries(rows.map(r => [r.tag, r]));
  assert.equal(by.M.total, null);
  assert.equal(by.M.noTotal, 'mixed');
  assert.equal(racewayLengthText(by.M, formatMeasurement, { mixed: 'Gemengde eenheden' }), 'Gemengde eenheden');
  assert.deepEqual(by.U.total, { value: 450, unit: 'pt', calibrated: false });
  assert.equal(racewayLengthText(by.U, formatMeasurement), 'Scale not set · 450 pt');
  assert.doesNotMatch(racewayLengthText(by.U, formatMeasurement), /ft|'/u, 'never fake feet');
  assert.equal(by.X.total, null, 'a calibrated and an uncalibrated run do not add up');
  assert.equal(by.X.noTotal, 'mixed');
});

test('fittings, pull boxes, risers and drops add up; worst bend section and over-360 flag', () => {
  useScale(QUARTER_INCH);
  const marked = conduit(BENDY, { tag: 'F-3', marks: { 0: 'up', 2: 'pull' } });   // sections [180, 45]
  const plain = conduit(BENDY, { tag: 'F-3', marks: { 4: 'down' } });             // [180] + 90 down = 270
  assert.deepEqual(marked.measureBendSections.map(Math.round), [180, 45]);
  const rows = racewaySchedule([marked, plain]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].fittings, [{ angle: 90, count: 2 }, { angle: 45, count: 3 },
    { angle: 'up', count: 1 }, { angle: 'down', count: 1 }, { angle: 'pull', count: 1 }]);
  assert.equal(Math.round(rows[0].bendMax), 270);
  assert.equal(rows[0].over360, false);
  assert.equal(racewayBendText(rows[0]), '270°');

  const stairs = conduit(STAIRS, { tag: 'F-3' });
  assert.ok(stairs.measureBendWarning);
  const over = racewaySchedule([marked, plain, stairs])[0];
  assert.equal(Math.round(over.bendMax), 450);
  assert.equal(over.over360, true);
  assert.equal(racewayBendText(over), '450° ⚠');
  // A pull box in the middle splits 450° into two legal sections.
  const split = conduit(STAIRS, { tag: 'P', marks: { 3: 'pull' } });
  const splitRow = racewaySchedule([split])[0];
  assert.equal(Math.round(splitRow.bendMax), 180);
  assert.equal(splitRow.over360, false);
});

test('the placed table has the legend table shape', () => {
  useScale(QUARTER_INCH);
  const rows = racewaySchedule([
    conduit(BENDY, { tag: 'F-3', marks: { 2: 'pull' } }),
    conduit(straight(60, 360), { tag: 'F-3' }),
    ladder(straight(220, 270)),
  ]);
  const labels = { title: 'Raceway schedule', tag: 'Tag', size: 'Raceway', runs: 'Runs', length: 'Length',
    bends: 'Max bends', fitting: (k) => ({ pull: 'Pull box' })[k] ?? `${k}°` };
  const table = racewayScheduleTable(rows, labels, formatMeasurement);
  assert.deepEqual(Object.keys(table).sort(), ['columns', 'height', 'rows', 'title', 'width']);
  assert.equal(table.title, 'Raceway schedule');
  assert.deepEqual(table.columns, ['Tag', 'Raceway', 'Runs', 'Length', '90°', '45°', 'Pull box', 'Max bends']);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0].cells.slice(0, 3), ['F-3', '3/4" EMT', '2']);
  assert.match(table.rows[0].cells[3], /^\d+'-\d/u);
  assert.deepEqual(table.rows[0].cells.slice(4), ['1', '1', '1', '90°']);
  assert.deepEqual(table.rows[1].cells, ['', '24" Ladder tray, 4" rail', '1', '15\'-0"', '', '', '', '']);
  assert.ok(table.rows.every(r => r.cells.length === table.columns.length));
  assert.equal(table.height, 22 + 2 * 18);
  assert.equal(table.width % table.columns.length, 0);
  const narrow = racewayScheduleTable(rows, labels, formatMeasurement, { maxWidth: 720 });
  assert.ok(table.width > 720 && narrow.width <= 720, `fits the page (${table.width} -> ${narrow.width})`);
  assert.deepEqual(narrow.rows, table.rows);
  // Untagged tray only: no Tag and no bends column.
  const trayOnly = racewayScheduleTable(racewaySchedule([ladder(straight(220, 270))]), labels, formatMeasurement);
  assert.deepEqual(trayOnly.columns, ['Raceway', 'Runs', 'Length']);
});

test('schedule strings exist in English and Dutch', () => {
  const en = JSON.parse(readFileSync(new URL('../i18n/locales/en/properties.json', import.meta.url), 'utf8')).racewaySchedule;
  const nl = JSON.parse(readFileSync(new URL('../i18n/locales/nl/properties.json', import.meta.url), 'utf8')).racewaySchedule;
  assert.deepEqual(Object.keys(nl).sort(), Object.keys(en).sort());
  for (const k of ['title', 'tag', 'size', 'runs', 'length', 'bends', 'place', 'placeTitle', 'none']) assert.ok(en[k] && nl[k], k);
});

test('branch fittings (tee, reducer) are schedule columns with their names', () => {
  useScale(QUARTER_INCH);
  const main = ladder([{ x: 60, y: 300 }, { x: 420, y: 300 }]);
  state.documents[0].annotations.push(main);
  const branch = createRacewayAnnotation([{ x: 200, y: 300 }, { x: 200, y: 450 }],
    { kind: 'tray', trayStyle: 'ladder', widthIn: 12, railIn: 4, branchOf: { id: main.id, at: { x: 200, y: 300 } } }, 1);
  state.documents[0].annotations.push(branch);
  const kinds = branch.measureFittings.map((f) => f.angle);
  assert.ok(kinds.includes('tee') && kinds.includes('reducer'), `branch fittings: ${kinds}`);
  const rows = racewaySchedule(state.documents[0].annotations);
  const table = racewayScheduleTable(rows, { title: 'S', tag: 'Tag', size: 'Raceway', runs: 'Runs', length: 'Length', bends: 'Max bends' }, formatMeasurement);
  const names = table.columns;
  assert.ok(JSON.stringify(names).includes('Tee'), JSON.stringify(names));
  assert.ok(JSON.stringify(names).includes('Reducer'));
  assert.ok(!JSON.stringify(names).includes('tee°'));
});
