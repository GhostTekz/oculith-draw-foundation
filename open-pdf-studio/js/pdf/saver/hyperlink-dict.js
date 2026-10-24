// Hyperlink markup (the external editor Hyperlink, Shift+H) as a PDF /Link annotation.
//
// The model: { type: 'hyperlink', x, y, width, height, linkUrl, linkPage }.
// Saved as /Subtype /Link with /A << /S /URI /URI (...) >> for a web address
// or /Dest [page /Fit] for a page in this document, or (Set Batch Link,
// linkFile) /A << /S /GoToR /F <relative path> /D [page-index /Fit] >> for a
// page in another PDF of the set, so every PDF reader
// follows it; the app's own link layer (js/pdf/link-layer.js) follows it too
// after reopening. /OPS_Subtype (hyperlink) marks the links this app made:
// only those come back as markups (and are rewritten on save). Every other
// /Link in a file stays untouched, as before.

import { PDFName, PDFString, PDFHexString } from 'pdf-lib';
import { decodePdfTextObject, pdfTextString } from './pdf-text.js';
import { isSafeLinkUrl } from '../link-destination.js';
import { isSafeRelativePdfPath } from '../remote-link.js';

export const HYPERLINK_SUBTYPE = 'hyperlink';

// '#2563eb' -> [r, g, b] in 0..1; null for anything else.
function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * A typed address as a URL a reader may open, or '' when it is not one.
 * 'www.example.com' gets https://; an e-mail address gets mailto:.
 */
export function normalizeHyperlinkUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  let url = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(mailto|tel):/i.test(url)) {
    url = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url) ? `mailto:${url}` : `https://${url}`;
  }
  // href: percent-encoded ASCII, as /URI requires.
  return isSafeLinkUrl(url) ? new URL(url).href : '';
}

// A file path as a PDF string: a literal for plain ASCII without the
// characters a literal must escape, otherwise a hex string (UTF-16 for
// non-ASCII names).
const fileString = (path) => (/^[\x20-\x7e]*$/u.test(path) && !/[()\\]/u.test(path)
  ? PDFString.of(path) : PDFHexString.fromText(path));

/**
 * Target of a hyperlink model: { url }, { file, page } (another PDF, by a
 * relative path) or { page }, or null when it has none.
 */
export function hyperlinkTarget(ann, pageCount = Infinity) {
  const url = normalizeHyperlinkUrl(ann?.linkUrl);
  if (url) return { url };
  const page = Number(ann?.linkPage);
  if (ann?.linkFile) {
    return isSafeRelativePdfPath(ann.linkFile) && Number.isInteger(page) && page >= 1
      ? { file: ann.linkFile, page } : null;
  }
  if (Number.isInteger(page) && page >= 1 && page <= pageCount) return { page };
  return null;
}

/** Is this PDF annotation dictionary a hyperlink markup made by this app? */
export function isAppHyperlinkDict(dict) {
  if (!dict || typeof dict.get !== 'function') return false;
  if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Link') return false;
  const sub = dict.get(PDFName.of('OPS_Subtype'));
  return !!sub && decodePdfTextObject(sub) === HYPERLINK_SUBTYPE;
}

/**
 * The /Link dictionary for a hyperlink model, or null without a valid target
 * (an unfinished link is not written).
 * @param {import('pdf-lib').PDFContext} context
 * @param {object} ann   the model, already in the unrotated page frame
 * @param {number[]} rect  [x1, y1, x2, y2] in PDF user space
 * @param {Array} pageRefs  page references of the document, in order
 * @param {number} flags  annotation flags (/F)
 */
export function buildHyperlinkDict(context, ann, rect, pageRefs, flags) {
  const target = hyperlinkTarget(ann, pageRefs.length);
  if (!target) return null;
  const dict = {
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    // Invisible in other readers, like an external editor hyperlink without a border.
    Border: [0, 0, 0],
    F: flags,
    T: pdfTextString(ann.author || 'User'),
    M: PDFString.of(new Date().toISOString()),
    OPS_Subtype: PDFString.of(HYPERLINK_SUBTYPE),
  };
  if (ann.subject) dict.Contents = pdfTextString(ann.subject);
  // Batch Link's outline (the external editor "Highlight Links"): a solid border every
  // reader draws, in the markup colour.
  const border = Number(ann.linkBorder);
  const rgb = hexToRgb01(ann.color);
  if (border > 0 && rgb) {
    dict.Border = [0, 0, border];
    dict.BS = context.obj({ Type: 'Border', W: border, S: PDFName.of('S') });
    dict.C = rgb;
  }
  // Made by Batch Link: Batch > Link > Remove deletes these.
  if (ann.batchLink) dict.OPS_BatchLink = true;
  if (target.url) {
    dict.A = context.obj({ Type: 'Action', S: 'URI', URI: PDFString.of(target.url) });
  } else if (target.file) {
    // The page of the other file by index (0-based for a remote /D), in a
    // new window: readers keep the referring sheet open.
    const spec = context.obj({ Type: 'Filespec', F: fileString(target.file), UF: fileString(target.file) });
    dict.A = context.obj({
      Type: 'Action', S: 'GoToR', F: spec, D: [target.page - 1, PDFName.of('Fit')], NewWindow: true,
    });
    dict.OPS_LinkFile = fileString(target.file);
    dict.OPS_LinkPage = target.page;
  } else {
    dict.Dest = context.obj([pageRefs[target.page - 1], PDFName.of('Fit')]);
    dict.OPS_LinkPage = target.page;
  }
  return context.obj(dict);
}
