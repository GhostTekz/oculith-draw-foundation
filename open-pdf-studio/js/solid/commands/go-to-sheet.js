// Go to Sheet (Ctrl+J, View ▸ Go To ▸ Go to
// Sheet…, the command palette): one quick box that jumps to a sheet of any
// open document by sheet number, page label or sheet title. Kept free of
// JSX and app state so it is unit tested (go-to-sheet.test.mjs); the box is
// components/GoToSheet.jsx.
//
// Sheet numbers match on their letters and digits only, so "E2", "e 2" and
// "E-2" all find E-201; titles use the command palette's word scoring.

import { matchEntry, normalize } from './palette.js';

/** Event that opens the Go to Sheet box. */
export const OPEN_GO_TO_SHEET = 'ocudraw:open-go-to-sheet';
export const SHEET_LIMIT = 40;

/** Letters and digits of a sheet number, lower case ("E-201" → "e201"). */
export function compactSheetNumber(text) {
  return normalize(text).replace(/[^a-z0-9]/g, '');
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const sameFile = (a, b) => !!a && !!b && a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();

/**
 * One row per page of each open document. docs: [{ index, name, filePath,
 * numPages, labels? }] (labels = the PDF page labels); register = the
 * drawing set's sheets ([{ label, title, filePath, page }]), which name and
 * title the pages they hold. The active document comes first.
 */
export function sheetCandidates(docs, { register = [], activeIndex = -1 } = {}) {
  const ordered = [...docs].sort((a, b) => (b.index === activeIndex) - (a.index === activeIndex));
  const out = [];
  for (const doc of ordered) {
    for (let page = 1; page <= (doc.numPages || 0); page++) {
      const sheet = register.find((s) => sameFile(s.filePath, doc.filePath) && Number(s.page) === page);
      const label = clean(doc.labels?.[page - 1]);
      const number = clean(sheet?.label) || (label && label !== String(page) ? label : '');
      out.push({
        key: `${doc.index}:${page}`, docIndex: doc.index, page, number,
        title: clean(sheet?.title), docName: doc.name || '', active: doc.index === activeIndex,
      });
    }
  }
  return out;
}

/** Score of one sheet for a query (0 = no match). */
export function scoreSheet(sheet, query) {
  const q = normalize(query);
  if (!q) return 0;
  const qc = compactSheetNumber(q);
  const nc = compactSheetNumber(sheet.number);
  let best = 0;
  if (qc && nc) {
    if (nc === qc) best = 1000;
    else if (nc.startsWith(qc)) best = 800 - Math.min(100, nc.length - qc.length);
    // The digits alone ("201" → E-201) or the number after its discipline.
    else if (/^\d+$/.test(qc) && nc.replace(/^[a-z]+/, '').startsWith(qc)) best = 600;
    else if (qc.length >= 2 && nc.includes(qc)) best = 400;
  }
  if (sheet.title) best = Math.max(best, Math.min(700, matchEntry({ label: sheet.title }, q).score * 2));
  // "E-201 lighting": the number plus title words.
  const parts = q.split(/\s+/);
  if (parts.length > 1 && nc && compactSheetNumber(parts[0]) && nc.startsWith(compactSheetNumber(parts[0]))) {
    const rest = parts.slice(1).join(' ');
    const titleScore = sheet.title ? matchEntry({ label: sheet.title }, rest).score : 0;
    if (titleScore) best = Math.max(best, 800 + titleScore);
  }
  if (/^\d+$/.test(q) && Number(q) === sheet.page) best = Math.max(best, nc ? 500 : 650);
  if (best && sheet.active) best += 5;
  return best;
}

/** The matching sheets, best first (ties keep the given order). */
export function rankSheets(sheets, query, limit = SHEET_LIMIT) {
  if (!normalize(query)) return sheets.filter((s) => s.number || s.title).concat(sheets.filter((s) => !s.number && !s.title)).slice(0, limit);
  return sheets
    .map((sheet, order) => ({ sheet, order, score: scoreSheet(sheet, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.sheet);
}
