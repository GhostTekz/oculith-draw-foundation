// Batch Link: find sheet references in the page text ("SEE A-103", the
// detail callout "3/A-102") and link each one to the page whose label is
// that sheet number. The links are hyperlink markups (saver/hyperlink-dict.js)
// with batchLink set: the Markups List shows them, Save writes them as /Link
// with a /Dest, and Batch > Link > Remove deletes exactly these.
//
// Pure: the caller provides the page labels and the text runs of each page
// (with a function that frames a character range in model space).

/** Default options, as the Batch Link dialog opens. */
export const BATCH_LINK_DEFAULTS = Object.freeze({
  wholeWord: true,
  caseSensitive: false,
  excludeSelf: true,
  callouts: true,
  highlight: 'outline', // 'outline' | 'none'
  color: '#2563eb',
  lineWidth: 1,
});

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Sheet targets from page labels: label -> page. Blank labels, labels that
 * are only a number (a page number would match every "1" in the text) and
 * labels used by more than one page (no single target) are left out; the
 * last two are reported.
 */
export function linkTargetsFromLabels(labels) {
  const pagesOf = new Map();
  (labels || []).forEach((raw, index) => {
    const label = String(raw ?? '').trim();
    if (!label || /^\d+$/.test(label)) return;
    if (!pagesOf.has(label)) pagesOf.set(label, []);
    pagesOf.get(label).push(index + 1);
  });
  const targets = new Map();
  const ambiguous = [];
  for (const [label, pages] of pagesOf) {
    if (pages.length === 1) targets.set(label, pages[0]);
    else ambiguous.push({ label, pages });
  }
  return { targets, ambiguous };
}

/**
 * A matcher for the targets: find(text) -> [{ start, end, text, label, page, callout }].
 * Whole word: the reference may not touch a letter or digit on either side.
 * Callouts: "5/A-501" (a detail number, a slash, the sheet) is one link to
 * A-501 covering the whole callout.
 */
export function referenceMatcher(targets, options = {}) {
  const { wholeWord = true, caseSensitive = false, callouts = true } = options;
  const labels = [...targets.keys()].sort((a, b) => b.length - a.length);
  if (!labels.length) return { find: () => [] };
  const byKey = new Map();
  for (const label of labels) {
    const key = caseSensitive ? label : label.toLocaleLowerCase();
    if (!byKey.has(key)) byKey.set(key, label);
  }
  const before = wholeWord ? '(?<![\\p{L}\\p{N}])' : '';
  const after = wholeWord ? '(?![\\p{L}\\p{N}])' : '';
  const detail = callouts ? '(?:([\\p{L}\\p{N}]{1,4})\\s?\\/\\s?)?' : '()';
  const source = `${before}${detail}(${labels.map(escapeRegExp).join('|')})${after}`;
  const flags = `gu${caseSensitive ? '' : 'i'}`;
  return {
    find(text) {
      const re = new RegExp(source, flags);
      const out = [];
      const str = String(text ?? '');
      let m;
      while ((m = re.exec(str))) {
        const key = caseSensitive ? m[2] : m[2].toLocaleLowerCase();
        const label = byKey.get(key);
        if (label) {
          out.push({
            start: m.index, end: m.index + m[0].length, text: m[0],
            label, page: targets.get(label), callout: !!m[1],
          });
        }
        if (m[0].length === 0) re.lastIndex++;
      }
      return out;
    },
  };
}

export function overlapRatio(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const smaller = Math.min(a.width * a.height, b.width * b.height) || 1;
  return (w * h) / smaller;
}

/**
 * Plan the links of a document.
 * @param {Array<{page:number, items:Array<{str:string, box:(from:number,to:number)=>object|null}>}>} pages
 * @param {string[]} labels  page labels, one per page
 * @param {object} [options]  BATCH_LINK_DEFAULTS plus
 *   existing: [{ page, x, y, width, height }] links already on the pages
 * @returns {{ links: object[], skipped: object[], ambiguous: object[], pagesWithoutText: number[] }}
 *   links:   { page, text, label, targetPage, rect }
 *   skipped: { page, text, label, targetPage, reason: 'self' | 'existing' }
 */
export function planBatchLinks(pages, labels, options = {}) {
  const opts = { ...BATCH_LINK_DEFAULTS, ...options };
  const { targets, ambiguous } = linkTargetsFromLabels(labels);
  const matcher = referenceMatcher(targets, opts);
  const existing = options.existing || [];
  const links = [];
  const skipped = [];
  const pagesWithoutText = [];
  for (const { page, items } of pages || []) {
    if (!(items || []).some(item => item?.str?.trim())) { pagesWithoutText.push(page); continue; }
    for (const item of items) {
      for (const hit of matcher.find(item.str)) {
        const entry = { page, text: hit.text, label: hit.label, targetPage: hit.page };
        if (opts.excludeSelf && hit.page === page) { skipped.push({ ...entry, reason: 'self' }); continue; }
        const rect = item.box(hit.start, hit.end);
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
        const taken = existing.concat(links).some(l => l.page === page && overlapRatio(l.rect || l, rect) > 0.5);
        if (taken) { skipped.push({ ...entry, reason: 'existing' }); continue; }
        links.push({ ...entry, rect });
      }
    }
  }
  return { links, skipped, ambiguous, pagesWithoutText };
}

/** The hyperlink markup (model properties) for a planned link. */
export function batchLinkMarkup(link, options = {}) {
  const opts = { ...BATCH_LINK_DEFAULTS, ...options };
  const pad = 1;
  const outline = opts.highlight === 'outline';
  return {
    type: 'hyperlink',
    page: link.page,
    x: link.rect.x - pad,
    y: link.rect.y - pad,
    width: link.rect.width + 2 * pad,
    height: link.rect.height + 2 * pad,
    linkUrl: '',
    linkPage: link.targetPage,
    batchLink: true,
    linkBorder: outline ? Math.max(0.25, Number(opts.lineWidth) || 1) : 0,
    color: opts.color || BATCH_LINK_DEFAULTS.color,
    strokeColor: opts.color || BATCH_LINK_DEFAULTS.color,
    lineWidth: outline ? Math.max(0.25, Number(opts.lineWidth) || 1) : 1,
    opacity: 1,
    subject: `${link.text} → ${link.label}`,
  };
}

/** Is this markup a link Batch Link made? */
export function isBatchLinkMarkup(ann) {
  return ann?.type === 'hyperlink' && ann.batchLink === true;
}
