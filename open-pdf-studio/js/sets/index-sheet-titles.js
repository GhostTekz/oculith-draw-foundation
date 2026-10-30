import { textItemBox } from '../pdf/region-text.js';
import { applySheetMetadataReview } from './sheet-metadata-review.js';

const SHEET_ID = /^[A-Z][A-Z0-9./-]*\d[A-Z0-9./-]*$/iu;
const ROW = /^([A-Z][A-Z0-9./-]*\d[A-Z0-9./-]*)\s+(.+)$/iu;

function clean(value) { return String(value ?? '').replace(/\s+/gu, ' ').trim(); }
function key(value) { return clean(value).toLocaleUpperCase(); }
function validTitle(value) {
  return value.length >= 3 && value.length <= 100 && /[\p{L}]/u.test(value)
    && !SHEET_ID.test(value) && !/^(?:rev(?:ision)?|date|scale|sheet|drawing)\b/iu.test(value)
    // A second sheet ID on one visual line often means adjacent table columns
    // were joined by text extraction. Leave that row for manual review.
    && !/(?:^|\s)[A-Z][A-Z0-9./-]*\d[A-Z0-9./-]*(?=\s|$)/iu.test(value);
}

function linesFromText(items, viewport) {
  if (!Array.isArray(items) || (!items.some(item => typeof item?.box === 'function')
    && typeof viewport?.convertToViewportPoint !== 'function')) return [];
  if (items.length > 5000) throw new Error('The selected page has too much text for a complete index review. Use a smaller index page.');
  const hits = [];
  for (const item of items) {
    const value = clean(item?.str);
    if (!value) continue;
    const box = typeof item.box === 'function' ? item.box(0, String(item.str).length)
      : textItemBox(item, viewport);
    if (box && box.width > 0 && box.height > 0) hits.push({ value, box, item,
      y: box.y + box.height / 2 });
  }
  hits.sort((a, b) => a.y - b.y || a.box.x - b.box.x);
  const lines = [];
  for (const hit of hits) {
    const candidate = lines[lines.length - 1];
    const line = candidate && Math.abs(candidate.y - hit.y)
      <= Math.min(candidate.height, hit.box.height) * 0.4 ? candidate : null;
    if (line) { line.hits.push(hit); line.y = (line.y * (line.hits.length - 1) + hit.y) / line.hits.length; }
    else lines.push({ y: hit.y, height: hit.box.height, hits: [hit] });
  }
  return lines.map(line => ({
    text: clean(line.hits.sort((a, b) => a.box.x - b.box.x).map(hit => hit.value).join(' ')),
    y: Math.round(line.y),
    hits: line.hits,
  })).filter(line => line.text).sort((a, b) => a.y - b.y);
}

function sheetIdRect(line, id, viewport) {
  const first = line.hits[0];
  if (!first || !first.value.toLocaleUpperCase().startsWith(id.toLocaleUpperCase())) return null;
  const from = /^\s*/u.exec(first.item.str)?.[0].length || 0;
  const to = from + id.length;
  return typeof first.item.box === 'function' ? first.item.box(from, to)
    : textItemBox(first.item, viewport, from, to);
}

/** Exact, review-only matches from one selectable PDF index page. */
export function indexSheetTitleSuggestions(items, viewport, sheets) {
  const byId = new Map();
  for (const sheet of sheets) {
    const id = key(sheet.label);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(sheet);
  }
  const found = new Map();
  const unmatched = [];
  for (const line of linesFromText(items, viewport)) {
    const match = ROW.exec(line.text);
    if (!match) continue;
    const id = key(match[1]);
    const title = clean(match[2]);
    if (!validTitle(title)) continue;
    const candidates = byId.get(id) || [];
    if (candidates.length !== 1) {
      unmatched.push({ text: line.text.slice(0, 140), y: line.y, reason: candidates.length
        ? 'Sheet ID is not unique in the register.' : 'No exact sheet ID in the register.' });
      continue;
    }
    const sheetId = candidates[0].id;
    if (!found.has(sheetId)) found.set(sheetId, []);
    found.get(sheetId).push({ title, evidence: line.text.slice(0, 140), y: line.y,
      rect: sheetIdRect(line, match[1], viewport) });
  }
  const matched = new Map();
  const conflicts = [];
  for (const [sheetId, rows] of found) {
    if (rows.length !== 1) {
      conflicts.push({ sheetId, lines: rows.map(row => row.evidence), y: Math.min(...rows.map(row => row.y)),
        reason: 'More than one index row matched this sheet ID.' });
    } else matched.set(sheetId, rows[0]);
  }
  return { matched, unmatched, conflicts, selectableText: Array.isArray(items)
    && items.some(item => clean(item?.str)) };
}

/** Keep index reviews title-only even if an edited row is passed to Apply. */
export function applyIndexSheetTitleReview(register, rows) {
  for (const row of rows.filter(item => item.selected)) {
    const sheet = register.sheets.find(item => item.id === row.sheetId);
    if (!sheet || row.originalLabel !== sheet.label || row.label !== sheet.label) {
      throw new Error('Index reviews can update titles only. Review the set again.');
    }
  }
  return applySheetMetadataReview(register, rows);
}
