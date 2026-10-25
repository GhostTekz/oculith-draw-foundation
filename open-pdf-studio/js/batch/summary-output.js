// Batch Summary, output side: the rows of every file combined into ONE
// summary, written as CSV, XLSX and a paginated table PDF (the external editor Markups
// Summary style: a table sorted by one column, a subtotal after each group
// and a totals table). Measurement totals add calibrated values per unit
// only; an uncalibrated value stays "Scale not set" and is counted apart.

import { PDFDocument, rgb } from 'pdf-lib';
import { edition } from '../editions/active.js';
import { buildXlsxSheets } from '../pdf/office-files.js';
import { printable, wrap } from '../annotations/markup-pdf.js';
import { drawBrandMark } from '../pdf/brand-mark-pdf.js';

// fontkit (about 0.5 MB) loads with the first report, not with the editor.
const loadFontkit = () => import('@pdf-lib/fontkit').then((m) => m.default);

/** Sort (and subtotal) columns the dialog offers. `file` keeps file and page order. */
export const SUMMARY_SORT_KEYS = Object.freeze(['file', 'subject', 'status', 'author', 'type', 'pageLabel']);
export const SUMMARY_FORMATS = Object.freeze(['csv', 'xlsx', 'pdf']);

const SORT_HEADINGS = { file: 'File', subject: 'Subject', status: 'Status', author: 'Author', type: 'Type', pageLabel: 'Page Label' };
const BASE_COLUMNS = ['File', 'Page Label', 'Page', 'Type', 'Subject', 'Status', 'Author', 'Date', 'Comments'];
const MEASURE_COLUMNS = ['Measurement', 'Value', 'Unit'];

const roundValue = (value) => Number(Number(value).toFixed(4));
const groupKey = (row, sortBy) => String(row[sortBy === 'file' ? 'file' : sortBy] ?? '').trim();

/**
 * Combine per-file results ([{ file: { name, path }, rows }]) and the run log
 * into one summary. Custom columns are matched by name across files (case-
 * insensitive), in first-seen order.
 */
export function combineSummaries(results, { sortBy = 'file', log = [], generatedAt = new Date(), title = 'Markups Summary' } = {}) {
  const sort = SUMMARY_SORT_KEYS.includes(sortBy) ? sortBy : 'file';
  const customColumns = [];
  const seen = new Set();
  const rows = [];
  (results || []).forEach(({ rows: fileRows }, fileIndex) => {
    for (const [order, row] of (fileRows || []).entries()) {
      for (const name of Object.keys(row.custom || {})) {
        const key = name.toLocaleLowerCase();
        if (!seen.has(key)) { seen.add(key); customColumns.push(name); }
      }
      rows.push({ ...row, _file: fileIndex, _order: order });
    }
  });
  if (sort !== 'file') {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    rows.sort((a, b) => {
      const ka = groupKey(a, sort);
      const kb = groupKey(b, sort);
      // Empty values last, like the Markups List.
      if (!ka !== !kb) return ka ? -1 : 1;
      return collator.compare(ka, kb) || a._file - b._file || a._order - b._order;
    });
  }
  return {
    title, sortBy: sort, generatedAt: new Date(generatedAt), customColumns,
    rows: rows.map(({ _file, _order, ...row }) => row),
    files: (log || []).map((entry) => ({ name: entry.name, path: entry.path, ok: !!entry.ok,
      count: entry.ok ? (results.find((r) => r.file?.path === entry.path)?.rows?.length ?? 0) : 0,
      error: entry.ok ? '' : entry.error || 'Failed' })),
  };
}

function customValue(row, name) {
  const key = name.toLocaleLowerCase();
  const found = Object.keys(row.custom || {}).find((k) => k.toLocaleLowerCase() === key);
  return found ? row.custom[found] : '';
}

/** Totals for a set of rows: count, calibrated sums per unit, uncalibrated count. */
export function totalsOf(rows) {
  const units = new Map();
  let uncalibrated = 0;
  for (const row of rows) {
    if (row.calibrated === false) uncalibrated++;
    else if (row.calibrated && Number.isFinite(row.value) && row.unit) units.set(row.unit, (units.get(row.unit) || 0) + row.value);
  }
  return { count: rows.length, sums: [...units].map(([unit, value]) => ({ unit, value: roundValue(value) })), uncalibrated };
}

export function totalsText({ sums, uncalibrated }) {
  return [...sums.map(({ value, unit }) => `${value} ${unit}`), ...(uncalibrated ? [`Scale not set: ${uncalibrated}`] : [])].join('; ');
}

/** Groups in summary order: [{ key, rows, totals }]. */
export function summaryGroups(summary) {
  const groups = [];
  for (const row of summary.rows) {
    const key = groupKey(row, summary.sortBy);
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
    groups[groups.length - 1].rows.push(row);
  }
  return groups.map((group) => ({ ...group, totals: totalsOf(group.rows) }));
}

/** The markups table: header and one array per markup. */
export function summaryTable(summary) {
  const header = [...BASE_COLUMNS, ...summary.customColumns, ...MEASURE_COLUMNS];
  const rows = summary.rows.map((row) => [
    row.file, row.pageLabel, row.page, row.type, row.subject, row.status, row.author, row.date, row.comments,
    ...summary.customColumns.map((name) => customValue(row, name)),
    row.measurement, row.value == null ? '' : roundValue(row.value), row.unit,
  ]);
  return { header, rows, valueIndex: header.length - 2, pageIndex: 2 };
}

/** The totals table: one row per group of the sort column and a grand total. */
export function totalsTable(summary) {
  const heading = SORT_HEADINGS[summary.sortBy] || 'File';
  const rows = summaryGroups(summary).map((group) => [group.key || '(none)', group.totals.count, totalsText(group.totals)]);
  rows.push(['Total', summary.rows.length, totalsText(totalsOf(summary.rows))]);
  return { header: [heading, 'Count', 'Measurement totals'], rows };
}

function csvCell(value, trustedNumber = false) {
  let text = String(value ?? '');
  // Spreadsheet programs can execute formulas in cells opened from CSV.
  if (!trustedNumber && /^[\s\x00-\x1f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** CSV: the markups table only, one line per markup (UTF-8 with BOM). */
export function summaryCsv(summary) {
  const { header, rows, valueIndex, pageIndex } = summaryTable(summary);
  const line = (cells, head = false) => cells.map((value, index) =>
    csvCell(value, !head && (index === valueIndex || index === pageIndex) && typeof value === 'number')).join(',');
  return '﻿' + [line(header, true), ...rows.map((row) => line(row))].join('\r\n') + '\r\n';
}

/** XLSX: Markups, Totals and Files sheets. */
export function summaryXlsx(summary) {
  const { header, rows } = summaryTable(summary);
  const totals = totalsTable(summary);
  const files = [['File', 'Result', 'Markups', 'Error'],
    ...summary.files.map((file) => [file.name, file.ok ? 'OK' : 'Failed', file.count, file.error])];
  return buildXlsxSheets([
    { name: 'Markups', rows: [header, ...rows.map((row) => row.map((cell) => cell ?? ''))] },
    { name: 'Totals', rows: [totals.header, ...totals.rows] },
    { name: 'Files', rows: files },
  ], { title: summary.title });
}

// ── PDF ─────────────────────────────────────────────────────────────────────
const WIDTH = 842; // A4 landscape
const HEIGHT = 595;
const MARGIN = 28;
const FOOTER = 30;
const SIZE = 7;
const LINE = 8.6;
const PAD = 2.5;
const ink = rgb(0.12, 0.16, 0.2);
const muted = rgb(0.38, 0.43, 0.48);
const accent = rgb(0.83, 0.43, 0.17);
const rule = rgb(0.78, 0.8, 0.82);
const headFill = rgb(0.14, 0.28, 0.4);
const groupFill = rgb(0.94, 0.95, 0.96);
const white = rgb(1, 1, 1);

const shortDate = (value) => {
  const text = String(value ?? '');
  const iso = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/u.exec(text);
  return iso ? `${iso[1]} ${iso[2]}` : text;
};

/**
 * A paginated table PDF of the summary. `fontBytes`: the bundled
 * LiberationSans (characters it cannot draw are shown as [U+XXXX]).
 */
export async function summaryPdf(summary, fontBytes) {
  const fontkit = await loadFontkit();
  if (!fontBytes?.byteLength) throw new Error('The bundled summary font is unavailable.');
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const face = fontkit.create(fontBytes);
  const font = await document.embedFont(fontBytes, { subset: false });
  document.setTitle(summary.title);
  document.setSubject('Markups summary across files; uncalibrated measurements are marked Scale not set');
  document.setCreator(edition.productName);
  document.setCreationDate(summary.generatedAt);
  const fallback = { used: false };
  const text = (value) => printable(value, face, fallback);

  const columns = [
    { title: 'File', weight: 1.3, get: (r) => r.file },
    { title: 'Page', weight: 0.55, get: (r) => r.pageLabel || r.page },
    { title: 'Subject', weight: 1.1, get: (r) => r.subject },
    { title: 'Status', weight: 0.75, get: (r) => r.status },
    { title: 'Author', weight: 0.85, get: (r) => r.author },
    { title: 'Date', weight: 0.85, get: (r) => shortDate(r.date) },
    { title: 'Comments', weight: 2.2, get: (r) => r.comments },
    ...summary.customColumns.map((name) => ({ title: name, weight: 0.85, get: (r) => customValue(r, name) })),
    { title: 'Measurement', weight: 1.4, get: (r) => r.measurement },
  ];
  const usable = WIDTH - 2 * MARGIN;
  const totalWeight = columns.reduce((sum, c) => sum + c.weight, 0);
  let x = MARGIN;
  for (const column of columns) {
    column.x = x;
    column.width = usable * column.weight / totalWeight;
    x += column.width;
  }

  const pages = [];
  let page;
  let y;
  const addPage = () => {
    page = document.addPage([WIDTH, HEIGHT]);
    pages.push(page);
    y = HEIGHT - MARGIN;
    page.drawRectangle({ x: 0, y: HEIGHT - 6, width: WIDTH, height: 6, color: accent });
  };
  const ensure = (height) => { if (y - height < FOOTER + 8) { addPage(); return true; } return false; };
  const paragraph = (value, { size = 9, color = ink, gap = 3 } = {}) => {
    for (const part of wrap(font, text(value), size, usable)) {
      ensure(size + gap);
      page.drawText(part, { x: MARGIN, y: y - size, font, size, color });
      y -= size + gap;
    }
  };
  const cellLines = (cols, values) => cols.map((c, i) => wrap(font, text(values[i] ?? ''), SIZE, c.width - 2 * PAD));
  const drawRow = (cols, lines, { fill = null, color = ink } = {}) => {
    const height = Math.max(...lines.map((l) => l.length)) * LINE + 2 * PAD;
    if (fill) page.drawRectangle({ x: cols[0].x, y: y - height, width: cols.reduce((s, c) => s + c.width, 0), height, color: fill });
    cols.forEach((c, i) => lines[i].forEach((part, n) => page.drawText(part, {
      x: c.x + PAD, y: y - PAD - SIZE - n * LINE + 1, font, size: SIZE, color })));
    y -= height;
    page.drawLine({ start: { x: cols[0].x, y }, end: { x: cols[cols.length - 1].x + cols[cols.length - 1].width, y }, thickness: 0.3, color: rule });
  };
  const header = (cols) => drawRow(cols, cellLines(cols, cols.map((c) => c.title)), { fill: headFill, color: white });
  const tableRow = (cols, values, options) => {
    const lines = cellLines(cols, values);
    const height = Math.max(...lines.map((l) => l.length)) * LINE + 2 * PAD;
    if (ensure(height)) header(cols);
    drawRow(cols, lines, options);
  };

  addPage();
  paragraph(summary.title.toUpperCase(), { size: 16, gap: 7 });
  const ok = summary.files.filter((f) => f.ok).length;
  paragraph(`Generated (UTC): ${summary.generatedAt.toISOString()} | ${summary.rows.length} markup${summary.rows.length === 1 ? '' : 's'} from ${ok} of ${summary.files.length} file${summary.files.length === 1 ? '' : 's'} | Sorted by ${SORT_HEADINGS[summary.sortBy]}`, { size: 8.5, color: muted });
  paragraph('Statuses and measurement texts are copied from the source markups. Totals add calibrated values per unit only; "Scale not set" values are page units, not physical lengths.', { size: 8, color: accent, gap: 6 });
  for (const file of summary.files.filter((f) => !f.ok)) paragraph(`Not included: ${file.name}: ${file.error}`, { size: 8, color: accent });
  y -= 4;

  header(columns);
  if (!summary.rows.length) tableRow(columns, ['No markups were found in the selected files.']);
  const groups = summaryGroups(summary);
  for (const group of groups) {
    for (const row of group.rows) tableRow(columns, columns.map((c) => c.get(row)));
    const label = `${SORT_HEADINGS[summary.sortBy]}: ${group.key || '(none)'} | ${group.totals.count} markup${group.totals.count === 1 ? '' : 's'}${totalsText(group.totals) ? ` | ${totalsText(group.totals)}` : ''}`;
    const span = [{ x: columns[0].x, width: usable, title: '' }];
    tableRow(span, [label], { fill: groupFill, color: muted });
  }

  // Totals per sort column, then the files.
  const totals = totalsTable(summary);
  const block = (title, head, rows, weights) => {
    y -= 10;
    ensure(40);
    paragraph(title, { size: 11, gap: 5 });
    const width = usable * 0.7;
    const sum = weights.reduce((s, w) => s + w, 0);
    let cx = MARGIN;
    const cols = head.map((h, i) => { const c = { title: h, x: cx, width: width * weights[i] / sum }; cx += c.width; return c; });
    header(cols);
    for (const row of rows) tableRow(cols, row.map((v) => String(v ?? '')));
  };
  block(`Totals by ${totals.header[0]}`, totals.header, totals.rows, [2, 0.6, 2.4]);
  block('Files', ['File', 'Result', 'Markups', 'Error'],
    summary.files.map((f) => [f.name, f.ok ? 'OK' : 'Failed', f.ok ? f.count : '', f.error]), [2, 0.6, 0.6, 2.4]);
  if (fallback.used) {
    y -= 6;
    paragraph('Some characters are shown as [U+XXXX] because the bundled font cannot draw them. The CSV and XLSX keep the original text.', { size: 8, color: muted });
  }

  for (const [index, sheet] of pages.entries()) {
    sheet.drawLine({ start: { x: MARGIN, y: FOOTER - 6 }, end: { x: WIDTH - MARGIN, y: FOOTER - 6 }, thickness: 0.5, color: rule });
    const mark = drawBrandMark(sheet, MARGIN, FOOTER - 20, 10);
    sheet.drawText(`${edition.productName} | ${text(summary.title)} | Page ${index + 1} of ${pages.length}`, { x: MARGIN + mark + 5, y: FOOTER - 18, font, size: 7.5, color: muted });
  }
  return document.save();
}

/** The output files a finished run writes: [{ name, bytes }] in format order. */
export async function buildSummaryOutputs(summary, { formats = SUMMARY_FORMATS, baseName = 'markups-summary', fontBytes } = {}) {
  const outputs = [];
  for (const format of SUMMARY_FORMATS.filter((f) => formats.includes(f))) {
    let bytes;
    if (format === 'csv') bytes = new TextEncoder().encode(summaryCsv(summary));
    else if (format === 'xlsx') bytes = summaryXlsx(summary);
    else bytes = await summaryPdf(summary, fontBytes);
    outputs.push({ name: `${baseName}.${format}`, bytes });
  }
  return outputs;
}
