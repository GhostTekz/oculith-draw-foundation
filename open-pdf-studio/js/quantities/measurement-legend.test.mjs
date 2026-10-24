// Measurement legend: rows per Subject and type with colour, count and the
// total in its unit (feet-inches for imperial lengths), for the page or the
// whole document; mixed units give no total; the placed table carries the
// same rows. Strings exist in English and Dutch.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('../core/app-test-hooks.mjs', import.meta.url);
const { installeerBrowserStubs } = await import('../core/app-test-hooks.mjs');
installeerBrowserStubs();
const { state } = await import('../core/state.js');
const { formatMeasurement } = await import('../annotations/measurement.js');
const { measurementLegend, legendTotalText, legendTable, swatchDataUrl } = await import('./measurement-legend.js');

state.preferences.measureRounding = 'none';

const dist = (page, value, unit, extra = {}) => ({ type: 'measureDistance', page, measureValue: value, measureUnit: unit,
  strokeColor: '#ff0000', ...extra });
const area = (page, value, unit, extra = {}) => ({ type: 'measureArea', page, measureValue: value, measureUnit: unit,
  color: '#0000ff', ...extra });

const ANNS = [
  dist(1, 10, 'ft'), dist(1, 13.875, 'ft'),
  dist(1, 4, 'ft', { subject: 'Wall', strokeColor: '#00aa00' }),
  dist(2, 5, 'ft'),
  area(1, 100, 'ft²'), area(1, 50.5, 'ft²'),
  { type: 'measureArea', page: 1, measureKind: 'volume', measureValue: 100, measureUnit: 'ft²',
    measureVolumeValue: 54, measureVolumeUnit: 'ft³', color: '#888888' },
  { type: 'measureAngle', page: 1, measureValue: 45, measureUnit: '°' },
  { type: 'count', page: 1, color: '#123456', subject: 'Outlets' },
  { type: 'box', page: 1 },
];

test('rows per type and subject for the current page, with colour, count and total', () => {
  const rows = measurementLegend(ANNS, { page: 1 });
  const brief = rows.map(r => [r.type, r.subject, r.count, r.color, legendTotalText(r, formatMeasurement)]);
  assert.deepEqual(brief, [
    ['measureDistance', '', 2, '#ff0000', '23\'-10 1/2"'],
    ['measureDistance', 'Wall', 1, '#00aa00', '4\'-0"'],
    ['measureArea', '', 2, '#0000ff', '150.50 ft²'],
    ['measureVolume', '', 1, '#888888', '54.00 ft³ (2.00 yd³)'],
    ['measureAngle', '', 1, '#000000', ''],
    ['count', 'Outlets', 1, '#123456', ''],
  ]);
});

test('the whole document adds the other pages', () => {
  const rows = measurementLegend(ANNS);
  const plain = rows.find(r => r.type === 'measureDistance' && !r.subject);
  assert.equal(plain.count, 3);
  assert.equal(legendTotalText(plain, formatMeasurement), '28\'-10 1/2"');
});

test('mixed units give no total; uncalibrated totals say so', () => {
  const rows = measurementLegend([dist(1, 10, 'ft'), dist(1, 3, 'm')], { page: 1 });
  assert.equal(rows[0].total, null);
  assert.equal(rows[0].noTotal, 'mixed');
  assert.equal(legendTotalText(rows[0], formatMeasurement, { mixed: 'Gemengde eenheden' }), 'Gemengde eenheden');
  const raw = measurementLegend([dist(1, 72, 'pt'), dist(1, 36, 'pt')], { page: 1 });
  assert.match(legendTotalText(raw[0], formatMeasurement), /^Scale not set · 108 pt$/u);
  const none = measurementLegend([{ type: 'measureArea', page: 1, measureKind: 'volume', measureValue: 4, measureUnit: 'm²' }]);
  assert.equal(none[0].noTotal, 'none', 'a Volume without depth has no volume to add');
});

test('the placed table has a swatch, the subject or type name, count and total', () => {
  const rows = measurementLegend(ANNS, { page: 1 });
  const table = legendTable(rows, { title: 'Legend', color: 'Color', subject: 'Subject', count: 'Count', total: 'Total',
    typeName: (t) => ({ measureDistance: 'Distance' })[t] || t }, formatMeasurement);
  assert.deepEqual(table.columns, ['Color', 'Subject', 'Count', 'Total']);
  assert.equal(table.rows.length, rows.length);
  assert.deepEqual(table.rows[0].cells.slice(1), ['Distance', '2', '23\'-10 1/2"']);
  assert.ok(table.rows[0].cells[0].startsWith('data:image/svg+xml,'));
  assert.ok(decodeURIComponent(table.rows[0].cells[0]).includes('fill="#ff0000"'));
  assert.ok(!decodeURIComponent(swatchDataUrl('red" onload="x')).includes('onload'), 'colours are sanitised');
  assert.equal(table.height, 22 + rows.length * 40);
});

test('the legend strings exist in English and Dutch and the panel uses them', () => {
  const read = (lang) => JSON.parse(readFileSync(new URL(`../i18n/locales/${lang}/properties.json`, import.meta.url), 'utf8'));
  const en = read('en'); const nl = read('nl');
  const src = readFileSync(new URL('../solid/components/left-panel/panels/MeasurementsPanel.jsx', import.meta.url), 'utf8');
  const used = [...src.matchAll(/t\('measurements\.(legend[a-zA-Z]*)'/g)].map(m => m[1]);
  assert.ok(used.length >= 8);
  for (const key of used) {
    assert.ok(en.measurements[key], `en measurements.${key}`);
    assert.ok(nl.measurements[key], `nl measurements.${key}`);
  }
  assert.ok(en.types.count && nl.types.count);
});
