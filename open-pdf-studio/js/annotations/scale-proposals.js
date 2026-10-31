// Scale proposals of a document: the scales read from each sheet's text
// (scale-notes.js), kept per page until the user reviews them.
//
// doc.scaleProposals = { [page]: { page, pageScale, views, info, scanned } }
//   pageScale / views[i]: a proposal (scale-notes.proposeScales) with
//   `id` and `status` 'pending' | 'applied' | 'rejected'.
//
// A proposal is not a calibration: it changes nothing until the user applies
// it, and until then the page keeps "Scale not set" for every measurement
// and total (K-004). Applying writes through the existing stores: the page
// scale (doc.pageScales, saved as /VP + /OPS_PageScale) and named viewports
// (scaleRegion, saved as /VP + /OPS_Viewport), with the source text kept so
// the status bar can say where the scale came from.

import { proposeScales, placeTextItems, placeOcrWords, noteKey, parseScaleNote } from './scale-notes.js';
import { formatRatio, parseRatioInput } from './scale-entry.js';
import { scaleDataFromEquation, validEquation } from './scale-presets.js';
import { paginaSchaal } from './schaal-op-punt.js';
import { pageTextContent } from '../pdf/page-text-content.js';

const STATUSES = new Set(['pending', 'applied', 'rejected']);

/** English labels; the UI passes its own translation function. */
const DEFAULT_LABELS = {
  titleBlock: 'Title block', view: 'View', sheet: 'Sheet note', scaleBar: 'Graphic scale',
};

/**
 * "Title block: SCALE: 1/8" = 1'-0"" — where a proposal came from.
 * @param {object} p  a proposal
 * @param {(key:string)=>string} [label]  translated source names
 */
export function sourceLabel(p, label = (k) => DEFAULT_LABELS[k] || k) {
  if (!p) return '';
  const kind = label(p.source);
  const head = p.source === 'view' && p.title ? `${kind} ${p.title}` : kind;
  return `${head}: ${p.sourceText || p.text || ''}`.trim();
}

function withIds(page, result) {
  const views = (result.views || []).map((v, i) => ({ ...v, id: `${page}:view:${i}`, status: 'pending' }));
  const pageScale = result.pageScale ? { ...result.pageScale, id: `${page}:page`, status: 'pending' } : null;
  return { page, scanned: true, pageScale, views,
    info: (result.info || []).map(({ kind, text, sourceText, title, inTitleBlock }) => ({ kind, text, sourceText, title, inTitleBlock })) };
}

/** The pending proposals of one page. */
export function pendingProposals(doc, pageNum) {
  const entry = doc?.scaleProposals?.[pageNum];
  if (!entry) return { page: null, views: [] };
  return {
    page: entry.pageScale?.status === 'pending' ? entry.pageScale : null,
    views: (entry.views || []).filter(v => v.status === 'pending'),
  };
}

/**
 * Read the scale notes of one page of THIS document and keep the proposals
 * (they replace earlier ones of that page, statuses included).
 * @param {object} doc
 * @param {number} pageNum
 * @returns {Promise<object|null>} the stored entry, or null when the document changed meanwhile
 */
export async function scanPageScales(doc, pageNum) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc) return null;
  const page = await pdfDoc.getPage(pageNum);
  const textContent = await pageTextContent(page);
  if (doc.pdfDoc !== pdfDoc) return null;
  const rotation = (((Number(page.rotate) || 0) + (Number(doc.pageRotations?.[pageNum]) || 0)) % 360 + 360) % 360;
  const viewport = page.getViewport({ scale: 1, rotation });
  let items = placeTextItems(textContent?.items || [], viewport);
  // OCR words of a scanned sheet that has no text of its own yet.
  const words = doc.ocrResults?.[pageNum];
  if (Array.isArray(words) && words.length && items.length < 20) {
    items = items.concat(placeOcrWords(words, viewport, page.view));
  }
  const knownRects = (doc.pdfViewports?.[pageNum] || [])
    .filter(v => v && v.paginaSchaal !== true && [v.x, v.y, v.width, v.height].every(Number.isFinite))
    .map(v => ({ x: v.x, y: v.y, width: v.width, height: v.height }));
  const [x0, y0, x1, y1] = page.view;
  const result = proposeScales(items, { width: viewport.width, height: viewport.height,
    widthPt: Math.abs(x1 - x0), heightPt: Math.abs(y1 - y0) }, { knownRects });
  const entry = withIds(pageNum, result);
  doc.scaleProposals = { ...(doc.scaleProposals || {}), [pageNum]: entry };
  return doc.scaleProposals[pageNum];
}

const inFlight = new WeakMap();

/** Scan a page once (the status bar asks on every page change). */
export function ensurePageScanned(doc, pageNum) {
  if (!doc?.pdfDoc || !(pageNum > 0)) return Promise.resolve(null);
  if (doc.scaleProposals?.[pageNum]) return Promise.resolve(doc.scaleProposals[pageNum]);
  let pages = inFlight.get(doc);
  if (!pages) { pages = new Map(); inFlight.set(doc, pages); }
  if (pages.has(pageNum)) return pages.get(pageNum);
  const p = scanPageScales(doc, pageNum).catch(() => null).finally(() => pages.delete(pageNum));
  pages.set(pageNum, p);
  return p;
}

/**
 * "Detect scales for all pages": scan every page that was not scanned yet.
 * @param {object} doc
 * @param {{onProgress?:(done:number,total:number)=>void, cancelled?:()=>boolean, rescan?:boolean}} [opts]
 */
export async function scanAllPages(doc, opts = {}) {
  const total = Number(doc?.pdfDoc?.numPages) || 0;
  for (let p = 1; p <= total; p++) {
    if (opts.cancelled?.()) break;
    if (opts.rescan || !doc.scaleProposals?.[p]) {
      try { await scanPageScales(doc, p); } catch { /* one unreadable page does not stop the rest */ }
    }
    opts.onProgress?.(p, total);
  }
  return doc.scaleProposals || {};
}

/**
 * Rows for the review list, page order, page scale before its views.
 * Notes that set nothing (NTS, AS NOTED) come along as information.
 * @param {object} doc
 * @param {number[]} [pages]  only these pages
 */
export function reviewRows(doc, pages) {
  const rows = [];
  const keys = Object.keys(doc?.scaleProposals || {}).map(Number).filter(n => n > 0).sort((a, b) => a - b);
  for (const page of keys) {
    if (pages && !pages.includes(page)) continue;
    const entry = doc.scaleProposals[page];
    const current = paginaSchaal(doc, page);
    for (const p of [entry.pageScale, ...(entry.views || [])].filter(Boolean)) {
      rows.push({
        id: p.id, page, target: p.target, title: p.title || '', ratio: p.ratio, ratioText: formatRatio(p.ratio),
        scaleText: p.text, sourceText: p.sourceText || p.text, source: p.source, confidence: p.confidence,
        status: p.status, bar: p.bar, sheetCheck: p.sheetCheck,
        currentScale: p.target === 'page' && current ? current : null, proposal: p,
      });
    }
    for (const info of entry.info || []) {
      rows.push({ id: `${page}:info:${rows.length}`, page, target: 'info', kind: info.kind, title: info.title || '',
        scaleText: info.text, sourceText: info.sourceText || info.text, status: 'info' });
    }
  }
  return rows;
}

/**
 * The scale a row stands for: its proposal, or the text the user typed in
 * its place ("1/4" = 1'-0"", "1:50"). null when the text is no scale.
 * @param {object} row
 * @param {string} [typed]
 * @returns {{ratio:number, equation:object, unit:string, text:string}|null}
 */
export function rowScale(row, typed) {
  const p = row?.proposal;
  if (typed == null || String(typed).trim() === '' || String(typed).trim() === p?.text) {
    const eq = validEquation(p?.equation);
    return eq ? { ratio: p.ratio, equation: eq, unit: eq.realUnit, text: p.text } : null;
  }
  const text = String(typed).trim();
  const note = parseScaleNote(text);
  if (note?.kind === 'scale') return { ratio: note.ratio, equation: note.equation, unit: note.unit, text: note.text };
  const n = parseRatioInput(text);
  if (!n) return null;
  const imperial = p?.imperial === true;
  const equation = imperial
    ? { paperValue: 1, paperUnit: 'in', realValue: Number((n / 12).toPrecision(10)), realUnit: 'ft' }
    : { paperValue: 1, paperUnit: 'mm', realValue: n, realUnit: 'mm' };
  return { ratio: n, equation, unit: equation.realUnit, text };
}

function setStatus(doc, page, id, status) {
  const entry = doc.scaleProposals?.[page];
  if (!entry || !STATUSES.has(status)) return;
  const next = { ...entry };
  if (next.pageScale?.id === id) next.pageScale = { ...next.pageScale, status };
  next.views = (next.views || []).map(v => (v.id === id ? { ...v, status } : v));
  doc.scaleProposals = { ...doc.scaleProposals, [page]: next };
}

/** Reject rows: the page keeps no scale from them. */
export function rejectRows(doc, rows) {
  for (const row of rows || []) if (row?.id && row.target !== 'info') setStatus(doc, row.page, row.id, 'rejected');
}

/**
 * Apply confirmed rows to the ACTIVE document (the one the user reviews):
 * page rows set the page scale, view rows add named viewports. One undo
 * step; every measurement is recalculated.
 * @param {object} doc  the active document
 * @param {Array<{row:object, typed?:string}>} picks
 * @param {{applyPageScale:Function, addViewports:Function, beginUndo?:Function, endUndo?:Function,
 *   label?:(k:string)=>string, viewName?:(page:number)=>string}} api
 * @returns {{applied:number, invalid:object[]}}
 */
export function applyRows(doc, picks, api) {
  const invalid = [];
  const pageGroups = new Map();
  const regions = [];
  const done = [];
  for (const { row, typed } of picks || []) {
    if (!row || row.target === 'info') continue;
    const scale = rowScale(row, typed);
    const proposal = { ...row.proposal, ...(scale ? { ratio: scale.ratio, text: scale.text,
      sourceText: scale.text === row.proposal?.text ? row.proposal.sourceText : scale.text } : {}) };
    const source = sourceLabel(proposal, api.label);
    if (!scale) { invalid.push(row); continue; }
    if (row.target === 'page') {
      const data = scaleDataFromEquation(scale.equation, { method: 'ratio' });
      if (!data) { invalid.push(row); continue; }
      data.source = source;
      const key = JSON.stringify(data);
      if (!pageGroups.has(key)) pageGroups.set(key, { data, pages: [] });
      pageGroups.get(key).pages.push(row.page);
    } else {
      const rect = row.proposal?.rect;
      if (!rect) { invalid.push(row); continue; }
      regions.push({ page: row.page, ...rect, label: row.title || api.viewName?.(row.page) || 'Viewport',
        scaleString: `1:${Number(scale.ratio.toPrecision(8))}`, units: scale.unit, equation: scale.equation, source });
    }
    done.push(row);
  }
  if (!done.length) return { applied: 0, invalid };
  api.beginUndo?.();
  try {
    for (const { data, pages } of pageGroups.values()) api.applyPageScale(data, pages);
    if (regions.length) api.addViewports(regions);
  } finally {
    api.endUndo?.();
  }
  for (const row of done) setStatus(doc, row.page, row.id, 'applied');
  return { applied: done.length, invalid };
}

/**
 * Pages whose pending page proposal is the same note as this row's
 * ("Apply to all sheets with the same note").
 */
export function sameNoteRows(doc, row) {
  if (row?.target !== 'page') return [];
  const key = noteKey(row.proposal);
  return reviewRows(doc).filter(r => r.target === 'page' && r.status === 'pending' && noteKey(r.proposal) === key);
}
