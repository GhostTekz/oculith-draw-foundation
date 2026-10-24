// Page labels (ISO 32000-1 §12.4.2, the catalog's /PageLabels number tree):
// "A-101" for page 1, "iv" for a front-matter page. Document > Page Labels
// edits them; the Navigation bar page field and the Markups List Page Label
// column read them back through PDF.js getPageLabels().
//
// The model is a list of ranges, as the number tree stores them:
//   { page, style, prefix, start }
//   page   first page of the range (1-based)
//   style  'D' decimal, 'R'/'r' roman upper/lower, 'A'/'a' letters, '' none
//   prefix text before the number ('' for none)
//   start  value of the number on the first page (>= 1)
// A page's label is prefix + the number in its style; a range without a
// style labels every page with just the prefix.
//
// Pure apart from the pdf-lib objects; no DOM, no app state.

import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';

export const LABEL_STYLES = ['D', 'R', 'r', 'A', 'a', ''];
const MAX_LABEL = 128;

function toRoman(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, glyph] of table) {
    while (n >= value) { out += glyph; n -= value; }
  }
  return out;
}

function fromRoman(text) {
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const v = values[text[i]];
    const next = values[text[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

// ISO 32000: A..Z for 1..26, AA..ZZ for 27..52, AAA.. and so on.
function toLetters(n) {
  const letter = String.fromCharCode(65 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}

/** The number `n` in a label style; '' for no style. */
export function formatLabelNumber(n, style) {
  if (!Number.isSafeInteger(n) || n < 1) return '';
  switch (style) {
    case 'D': return String(n);
    case 'R': return toRoman(n);
    case 'r': return toRoman(n).toLowerCase();
    case 'A': return toLetters(n);
    case 'a': return toLetters(n).toLowerCase();
    default: return '';
  }
}

/** Label of page `page` (1-based) inside `range`. */
export function labelInRange(range, page) {
  const n = (range.start || 1) + (page - range.page);
  return `${range.prefix || ''}${formatLabelNumber(n, range.style || '')}`;
}

/** A clean label: one line, trimmed, no control characters, bounded length. */
export function cleanPageLabel(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL);
}

function sanitizeRange(raw, pageCount) {
  const page = Number(raw?.page);
  if (!Number.isInteger(page) || page < 1 || page > pageCount) return null;
  const style = LABEL_STYLES.includes(raw?.style) ? raw.style : '';
  const start = Number.isSafeInteger(Number(raw?.start)) && Number(raw.start) >= 1 ? Number(raw.start) : 1;
  // A prefix keeps its spaces ("App " + "A"); only control characters go.
  const prefix = String(raw?.prefix ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_LABEL);
  return { page, style, prefix, start };
}

/**
 * Labels of every page from ranges: an array of `pageCount` strings. Pages
 * before the first range have no label (''), as in PDF.js.
 */
export function labelsFromRanges(ranges, pageCount) {
  const sorted = (ranges || []).map(r => sanitizeRange(r, pageCount)).filter(Boolean)
    .sort((a, b) => a.page - b.page);
  const labels = new Array(Math.max(0, pageCount)).fill('');
  sorted.forEach((range, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1].page - 1 : pageCount;
    for (let p = range.page; p <= end; p++) labels[p - 1] = labelInRange(range, p);
  });
  return labels;
}

// The range a label starts when the previous range cannot continue.
function rangeForLabel(label, page) {
  if (!label) return { page, style: 'D', prefix: '', start: page };
  const decimal = label.match(/^(.*?)([1-9]\d{0,8})$/s);
  if (decimal) return { page, style: 'D', prefix: decimal[1], start: Number(decimal[2]) };
  for (const style of ['r', 'R']) {
    const roman = label.match(style === 'r' ? /^(.*?)([ivxlcdm]+)$/s : /^(.*?)([IVXLCDM]+)$/s);
    if (!roman) continue;
    const n = fromRoman(roman[2].toUpperCase());
    // Only a well-formed roman number, and not a lone letter after a prefix
    // ("A-C" stays a prefix): "iv", "XII".
    if (n >= 1 && formatLabelNumber(n, style) === roman[2] && (!roman[1] || roman[2].length > 1)) {
      return { page, style, prefix: roman[1], start: n };
    }
  }
  return { page, style: '', prefix: label, start: 1 };
}

/**
 * The fewest ranges that reproduce `labels` (one string per page). A blank
 * label becomes the page number, which readers show as an unlabelled page.
 * "A-101", "A-102", "A-103" is one range: prefix "A-", decimal, start 101.
 */
export function rangesFromLabels(labels) {
  const ranges = [];
  let current = null;
  (labels || []).forEach((raw, index) => {
    const page = index + 1;
    const label = cleanPageLabel(raw);
    const wanted = label || String(page);
    if (current && labelInRange(current, page) === wanted) return;
    current = rangeForLabel(label, page);
    ranges.push(current);
  });
  return ranges;
}

/** True when the ranges label every page with its own number (no labels). */
export function rangesArePlainNumbers(ranges, pageCount) {
  const labels = labelsFromRanges(ranges, pageCount);
  return labels.every((label, i) => label === String(i + 1));
}

/**
 * Overwrite the labels of pages `from`..`to` with a numbering range (the
 * Page Labels dialog's "Apply numbering"). Returns a new labels array.
 */
export function applyNumbering(labels, { from, to, style = 'D', prefix = '', start = 1 }) {
  const out = [...labels];
  const first = Math.max(1, Math.min(from, to));
  const last = Math.min(out.length, Math.max(from, to));
  const range = sanitizeRange({ page: first, style, prefix, start }, out.length);
  if (!range) return out;
  for (let p = first; p <= last; p++) out[p - 1] = labelInRange(range, p);
  return out;
}

// --- pdf-lib ----------------------------------------------------------------

function decodeText(obj) {
  if (obj instanceof PDFHexString || obj instanceof PDFString) {
    try { return obj.decodeText(); } catch { return ''; }
  }
  return '';
}

/**
 * The ranges of a pdf-lib document's /PageLabels (number tree with /Nums and
 * /Kids), or [] when it has none. A malformed tree yields what could be read.
 */
export function readPageLabelRanges(pdfDoc) {
  const context = pdfDoc.context;
  const pageCount = pdfDoc.getPageCount();
  const root = pdfDoc.catalog.lookupMaybe(PDFName.of('PageLabels'), PDFDict);
  if (!root) return [];
  const ranges = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!(node instanceof PDFDict) || depth > 32 || seen.has(node)) return;
    seen.add(node);
    const nums = node.lookupMaybe(PDFName.of('Nums'), PDFArray);
    if (nums) {
      for (let i = 0; i + 1 < nums.size(); i += 2) {
        const key = nums.lookup(i);
        const dict = nums.lookup(i + 1);
        if (!(key instanceof PDFNumber) || !(dict instanceof PDFDict)) continue;
        const style = dict.lookup(PDFName.of('S'));
        const start = dict.lookup(PDFName.of('St'));
        const range = sanitizeRange({
          page: key.asNumber() + 1,
          style: style instanceof PDFName ? style.decodeText() : '',
          prefix: decodeText(dict.lookup(PDFName.of('P'))),
          start: start instanceof PDFNumber ? start.asNumber() : 1,
        }, pageCount);
        if (range) ranges.push(range);
      }
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(context.lookup(kids.get(i)), depth + 1);
  };
  walk(root, 0);
  ranges.sort((a, b) => a.page - b.page);
  return ranges.filter((r, i) => i === 0 || r.page !== ranges[i - 1].page);
}

/**
 * Write `labels` (one per page) as the document's /PageLabels. Blank labels
 * are page numbers; when no page has a label of its own the entry is
 * removed. Returns the ranges written.
 */
export function writePageLabels(pdfDoc, labels) {
  const pageCount = pdfDoc.getPageCount();
  const list = Array.from({ length: pageCount }, (_, i) => labels?.[i] ?? '');
  const ranges = rangesFromLabels(list);
  if (rangesArePlainNumbers(ranges, pageCount)) {
    pdfDoc.catalog.delete(PDFName.of('PageLabels'));
    return [];
  }
  const context = pdfDoc.context;
  const nums = [];
  for (const range of ranges) {
    const dict = {};
    if (range.style) dict.S = PDFName.of(range.style);
    if (range.prefix) dict.P = PDFHexString.fromText(range.prefix);
    if (range.style && range.start !== 1) dict.St = range.start;
    nums.push(range.page - 1, context.obj(dict));
  }
  pdfDoc.catalog.set(PDFName.of('PageLabels'), context.obj({ Nums: nums }));
  return ranges;
}

/**
 * Proposed labels from the text found in a page region (one string per
 * page), for the preview before Apply:
 *   { page, current, found, label, note }
 * A page with no text keeps its current label (note 'blank'). A text found
 * on more than one page is made unique with " (2)", " (3)"... on the later
 * pages (note 'duplicate'), so every label still names one page.
 */
export function proposeLabelsFromTexts(texts, current = []) {
  const used = new Map();
  const rows = (texts || []).map((raw, index) => {
    const page = index + 1;
    const found = cleanPageLabel(raw);
    const now = cleanPageLabel(current[index]);
    if (!found) return { page, current: now, found: '', label: now, note: 'blank' };
    return { page, current: now, found, label: found, note: null };
  });
  for (const row of rows) {
    if (row.note === 'blank' || !row.label) continue;
    const key = row.label.toLocaleLowerCase();
    const count = (used.get(key) || 0) + 1;
    used.set(key, count);
    if (count > 1) {
      let n = count;
      while (used.has(`${row.label} (${n})`.toLocaleLowerCase())) n++;
      row.label = `${row.label} (${n})`;
      used.set(row.label.toLocaleLowerCase(), 1);
      row.note = 'duplicate';
    }
  }
  return rows;
}
