// Raceway schedule (the external editor's Legend / Markups Summary for raceways): one row
// per run tag and size ('F-3' + '3/4" EMT'), or per size when the runs carry
// no tag, with the number of runs, the developed length, the fittings by
// angle and, for conduit, the worst pull section's bends. Lengths add up only
// when every run of a row has the same unit and calibration state; an
// uncalibrated row stays in page units with "Scale not set" (never feet).
// Pure, so node tests it; MeasurementsPanel shows it and places it on the
// page as a scheduleTable, the same way as the measurement legend.

import { measureKindType } from '../annotations/measure-extras.js';
import { normalizeRaceway, racewayLabel, NEC_MAX_BENDS } from '../annotations/raceway.js';

/** Fitting kinds in schedule order: elbows by angle, then risers, drops and pull boxes. */
export const FITTING_ORDER = Object.freeze([90, 60, 45, 30, 'custom', 'up', 'down', 'pull', 'tee', 'cross', 'reducer']);

const FITTING_NAMES = Object.freeze({ 90: '90°', 60: '60°', 45: '45°', 30: '30°', custom: 'Custom',
  up: '90° up', down: '90° down', pull: 'Pull box', tee: 'Tee', cross: 'Cross', reducer: 'Reducer' });

const UNCALIBRATED = /^pt$/u;

/** Is `ann` a raceway run (a measurePerimeter with measureKind 'raceway')? */
export function isRaceway(ann) {
  return !!ann && measureKindType(ann) === 'measureRaceway';
}

const fittingKey = (angle) => (typeof angle === 'string' && !/^\d+$/u.test(angle) ? angle : Number(angle));

/** The bend total per pull section of a run: [180, 45]; [] when unknown. */
export function runBendSections(ann) {
  if (Array.isArray(ann?.measureBendSections) && ann.measureBendSections.length) {
    return ann.measureBendSections.filter(Number.isFinite);
  }
  return Number.isFinite(ann?.measureBendTotal) ? [ann.measureBendTotal] : [];
}

/** Bends per pull section as text: '180° | 45°' ('' when unknown). */
export function runBendsText(ann) {
  return runBendSections(ann).map(v => `${Math.round(v)}°`).join(' | ');
}

/**
 * @typedef {object} RacewayRow
 * @property {string} key
 * @property {string} tag        run tag, '' when untagged
 * @property {string} size       size label ('3/4" EMT', '24" Ladder tray, 4" rail')
 * @property {'conduit'|'tray'} kind
 * @property {string} color      colour of the first run
 * @property {number} count      number of runs
 * @property {{value:number, unit:string, calibrated:boolean}|null} total  developed length
 * @property {'mixed'|'none'|null} noTotal  why there is no total
 * @property {Array<{angle:number|string, count:number}>} fittings  in FITTING_ORDER
 * @property {number|null} bendMax  conduit: the worst pull section of any run (degrees)
 * @property {boolean} over360      conduit: a run has a section over 360°
 * @property {string[]} ids
 */

/**
 * The schedule rows of `annotations`.
 * @param {Array<object>} annotations
 * @param {{page?:number|null}} [options]  page: only that page; null/undefined: the whole document
 * @returns {RacewayRow[]}
 */
export function racewaySchedule(annotations, options = {}) {
  const page = options.page ?? null;
  const groups = new Map();
  for (const ann of annotations || []) {
    if (!isRaceway(ann)) continue;
    if (page != null && ann.page !== page) continue;
    const rw = normalizeRaceway(ann.raceway);
    const tag = rw.tag || '';
    const size = String(ann.subject ?? '').trim() || racewayLabel(rw);
    const key = `${tag}\u0000${rw.kind}\u0000${size}`;
    let g = groups.get(key);
    if (!g) {
      const c = ann.strokeColor || ann.color;
      groups.set(key, g = { key, tag, size, kind: rw.kind, color: typeof c === 'string' && c ? c : '#000000', items: [] });
    }
    g.items.push(ann);
  }
  const rows = [...groups.values()].map(g => {
    const row = { key: g.key, tag: g.tag, size: g.size, kind: g.kind, color: g.color, count: g.items.length,
      total: null, noTotal: null, fittings: [], bendMax: null, over360: false,
      ids: g.items.map(a => a.id).filter(id => id != null) };
    // Length: one unit and one calibration state, or no total.
    const measured = g.items.filter(a => Number.isFinite(a.measureValue));
    if (!measured.length) row.noTotal = 'none';
    else {
      const units = new Set(measured.map(a => a.measureUnit || ''));
      const calib = new Set(measured.map(a => a.measureCalibrated !== false && !UNCALIBRATED.test(a.measureUnit || '')));
      const unit = [...units][0];
      if (units.size !== 1 || !unit || calib.size !== 1 || measured.length !== g.items.length) row.noTotal = 'mixed';
      else row.total = { value: measured.reduce((s, a) => s + a.measureValue, 0), unit, calibrated: [...calib][0] };
    }
    // Fittings by kind.
    const counts = new Map();
    for (const a of g.items) {
      for (const f of Array.isArray(a.measureFittings) ? a.measureFittings : []) {
        const n = Number(f?.count);
        if (!(n > 0)) continue;
        const k = fittingKey(f.angle);
        counts.set(k, (counts.get(k) || 0) + n);
      }
    }
    const rank = (k) => { const i = FITTING_ORDER.indexOf(k); return i === -1 ? FITTING_ORDER.length : i; };
    row.fittings = [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([angle, count]) => ({ angle, count }));
    // NEC bends (conduit): the worst pull section of any run.
    if (g.kind === 'conduit') {
      for (const a of g.items) {
        const secs = runBendSections(a);
        if (!secs.length) continue;
        const max = Math.max(...secs);
        row.bendMax = row.bendMax == null ? max : Math.max(row.bendMax, max);
        if (a.measureBendWarning || max > NEC_MAX_BENDS + 0.5) row.over360 = true;
      }
    }
    return row;
  });
  const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  rows.sort((a, b) => (a.tag ? 0 : 1) - (b.tag ? 0 : 1) || cmp(a.tag, b.tag)
    || (a.kind === b.kind ? 0 : a.kind === 'conduit' ? -1 : 1) || cmp(a.size, b.size));
  return rows;
}

/**
 * The text of a row's length: `format` is formatMeasurement (feet-inches for
 * imperial lengths, "Scale not set · 450 pt" when uncalibrated);
 * `labels.mixed` / `labels.none` when there is no total.
 */
export function racewayLengthText(row, format, labels = {}) {
  if (row.total) return format({ value: row.total.value, unit: row.total.unit, calibrated: row.total.calibrated });
  if (row.noTotal === 'mixed') return labels.mixed ?? 'Mixed or unknown units';
  return labels.none ?? '';
}

/** A row's worst bends as text: '270°', '450° ⚠' ('' for tray). */
export function racewayBendText(row) {
  if (row.bendMax == null) return '';
  return `${Math.round(row.bendMax)}°${row.over360 ? ' ⚠' : ''}`;
}

/** Fitting kinds that occur in `rows`, in FITTING_ORDER. */
export function scheduleFittingKinds(rows) {
  const present = new Set((rows || []).flatMap(r => r.fittings.map(f => f.angle)));
  return [...FITTING_ORDER.filter(k => present.has(k)), ...[...present].filter(k => !FITTING_ORDER.includes(k))];
}

const CHAR_W = 5.6, PAD = 12, MIN_COL = 64, MAX_COL = 140;

/**
 * The schedule as scheduleTable content ({title, columns, rows, width, height}),
 * the shape legendTable gives, for placing it on the page. A Tag column only
 * when a row has a tag, one column per fitting kind in use, a Max bends
 * column only when there is conduit.
 * @param {RacewayRow[]} rows
 * @param {{title:string, tag:string, size:string, runs:string, length:string, bends:string,
 *   fitting?:(kind:number|string)=>string, mixed?:string, none?:string}} labels
 * @param {(m:object)=>string} format  formatMeasurement
 * @param {{maxWidth?:number}} [options]  maxWidth: narrow the columns (cells clip) to fit the page
 */
export function racewayScheduleTable(rows, labels, format, options = {}) {
  const withTag = rows.some(r => r.tag);
  const withBends = rows.some(r => r.kind === 'conduit');
  const kinds = scheduleFittingKinds(rows);
  const fittingName = (k) => labels.fitting?.(k) ?? FITTING_NAMES[k] ?? `${k}°`;
  const columns = [...(withTag ? [labels.tag] : []), labels.size, labels.runs, labels.length,
    ...kinds.map(fittingName), ...(withBends ? [labels.bends] : [])];
  const tableRows = rows.map(r => {
    const by = new Map(r.fittings.map(f => [f.angle, f.count]));
    return { cells: [
      ...(withTag ? [r.tag] : []),
      r.size,
      String(r.count),
      racewayLengthText(r, format, labels),
      ...kinds.map(k => (by.has(k) ? String(by.get(k)) : '')),
      ...(withBends ? [racewayBendText(r)] : []),
    ] };
  });
  // Equal columns (the table draws them so): wide enough for the longest cell.
  const longest = Math.max(0, ...columns.map(c => String(c).length),
    ...tableRows.flatMap(r => r.cells.map(c => String(c).length)));
  let colW = Math.min(MAX_COL, Math.max(MIN_COL, longest * CHAR_W + PAD));
  if (options.maxWidth > 0) colW = Math.max(MIN_COL / 2, Math.min(colW, options.maxWidth / columns.length));
  colW = Math.floor(colW);
  return { title: labels.title, columns, rows: tableRows, width: columns.length * colW, height: 22 + tableRows.length * 18 };
}
