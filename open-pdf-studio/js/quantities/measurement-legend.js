// Measurement legend (the external editor's Legend): one row per Subject and measurement
// type with its colour, count and total, for the current page or the whole
// document. Totals follow the measurement panel rule (sumMeasurements): only
// values of one known unit add up; mixed or unknown units give no total.
// A Volume adds its volume, an Angle or Count only counts. Pure, so node
// tests it; MeasurementsPanel shows it and can place it on the page as a
// scheduleTable.

import { sumMeasurements } from './measurement-summary.js';
import { measureKindType, summaryValue } from '../annotations/measure-extras.js';

const MEASURE_TYPES = new Set(['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']);
const COUNT_ONLY = new Set(['measureAngle', 'count']);

// Legend order of the types (as the measurement panel lists them).
const TYPE_ORDER = ['measureDistance', 'measurePolylength', 'measurePerimeter', 'measureArc', 'measureRadius',
  'measureArea', 'measureVolume', 'measureAngle', 'count'];

const UNCALIBRATED = /^pt[²³]?$/u;

function rowType(ann) {
  if (ann?.type === 'count') return 'count';
  return MEASURE_TYPES.has(ann?.type) ? measureKindType(ann) : null;
}

function colorOf(ann) {
  const c = ann.strokeColor || ann.color || ann.fillColor;
  return typeof c === 'string' && c ? c : '#000000';
}

/**
 * @typedef {object} LegendRow
 * @property {string} key       type + subject
 * @property {string} type      measurement type id ('measureDistance', 'measureVolume', 'count', ...)
 * @property {string} subject   the markups' Subject, '' when none (show the type name)
 * @property {string} color     colour of the first markup in the row
 * @property {number} count
 * @property {{value:number, unit:string, calibrated:boolean}|null} total
 * @property {'mixed'|'none'|null} noTotal  why there is no total ('none': nothing measured;
 *   null for a total or a count-only type)
 */

/**
 * The legend rows of `annotations`.
 * @param {Array<object>} annotations
 * @param {{page?:number|null}} [options]  page: only that page; null/undefined: the whole document
 * @returns {LegendRow[]}
 */
export function measurementLegend(annotations, options = {}) {
  const page = options.page ?? null;
  const groups = new Map();
  for (const ann of annotations || []) {
    if (page != null && ann?.page !== page) continue;
    const type = rowType(ann);
    if (!type) continue;
    const subject = String(ann.subject ?? '').trim();
    const key = `${type}\u0000${subject}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, type, subject, color: colorOf(ann), items: [] });
    g.items.push(ann);
  }
  const rows = [...groups.values()].map(g => {
    const row = { key: g.key, type: g.type, subject: g.subject, color: g.color, count: g.items.length,
      total: null, noTotal: null };
    if (COUNT_ONLY.has(g.type)) return row;
    const values = g.items.map(summaryValue);
    const sum = sumMeasurements(values);
    if (sum) {
      const calibrated = !UNCALIBRATED.test(sum.unit) && g.items.every(a => a.measureCalibrated !== false);
      row.total = { value: sum.value, unit: sum.unit, calibrated };
    } else {
      row.noTotal = values.some(v => Number.isFinite(v.measureValue)) ? 'mixed' : 'none';
    }
    return row;
  });
  const order = (t) => { const i = TYPE_ORDER.indexOf(t); return i === -1 ? TYPE_ORDER.length : i; };
  rows.sort((a, b) => order(a.type) - order(b.type) || a.subject.localeCompare(b.subject));
  return rows;
}

/**
 * The text of a row's total: `format` is formatMeasurement (feet-inches for
 * imperial lengths, "Scale not set" when uncalibrated); '' for count-only
 * types; `labels.mixed` / `labels.none` when there is no total.
 */
export function legendTotalText(row, format, labels = {}) {
  if (row.total) return format({ value: row.total.value, unit: row.total.unit, calibrated: row.total.calibrated });
  if (row.noTotal === 'mixed') return labels.mixed ?? 'Mixed or unknown units';
  if (row.noTotal === 'none') return labels.none ?? '';
  return '';
}

/** A small colour square as an image cell for the placed table. */
export function swatchDataUrl(color) {
  const safe = /^#[0-9a-f]{3,8}$/iu.test(color) || /^[a-z]+$/iu.test(color) || /^rgba?\([\d\s.,%]+\)$/iu.test(color) ? color : '#000000';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect x="1" y="1" width="14" height="14" fill="${safe}" stroke="#555" stroke-width="1"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The legend as scheduleTable content ({title, columns, rows, width, height})
 * for placing it on the page.
 * @param {LegendRow[]} rows
 * @param {{title:string, color:string, subject:string, count:string, total:string, typeName:(type:string)=>string,
 *   mixed?:string, none?:string}} labels
 * @param {(m:object)=>string} format  formatMeasurement
 */
export function legendTable(rows, labels, format) {
  const columns = [labels.color, labels.subject, labels.count, labels.total];
  const tableRows = rows.map(r => ({ cells: [
    swatchDataUrl(r.color),
    r.subject || labels.typeName(r.type),
    String(r.count),
    legendTotalText(r, format, labels),
  ] }));
  return { title: labels.title, columns, rows: tableRows, width: 4 * 110, height: 22 + tableRows.length * 40 };
}
