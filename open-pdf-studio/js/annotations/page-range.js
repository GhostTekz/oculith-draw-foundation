// Page ranges typed in Set Scale ("1-3,5"). Pure, so node tests it.

/**
 * Parse a page range against the document's page count.
 * Accepts single pages and ascending ranges separated by commas, with any
 * spaces: "1-3,5", "2, 4 - 6". The result is sorted and deduplicated.
 * @param {string} text
 * @param {number} pageCount
 * @returns {{pages:number[]} | {error:'empty'|'syntax'|'outOfRange', part?:string}}
 */
export function parsePageRange(text, pageCount) {
  const s = String(text ?? '').trim();
  if (!s) return { error: 'empty' };
  const max = Number(pageCount);
  const pages = new Set();
  for (const raw of s.split(',')) {
    const part = raw.trim();
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/u);
    if (!m) return { error: 'syntax', part };
    const from = Number(m[1]);
    const to = m[2] != null ? Number(m[2]) : from;
    if (from < 1 || to < from) return { error: 'syntax', part };
    if (Number.isInteger(max) && max > 0 && to > max) return { error: 'outOfRange', part };
    if (to - from > 100000) return { error: 'outOfRange', part };
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return { pages: [...pages].sort((a, b) => a - b) };
}
