// Document-level measure scale without any app state: every function here
// works on the document it is handed, never on "the active document".
//
// loadPDF uses these for documents that finish loading in a background tab
// (multi-file open, session restore behind a document the user just opened).
// There the tab in front is a different PDF: reading ITS title block, or
// writing the scale to IT, gives wrong lengths and areas in both files
// without any visible sign.

import { geldigeSchaal } from './schaal-op-punt.js';
import { pageTextContent } from '../pdf/page-text-content.js';

// Patterns ordered from most specific (labelled) to least specific (bare 1:N).
// The labelled pattern avoids false positives from dimensions like "2:3".
// "1/N" followed by an inch mark is a paper length (1/4"), not a ratio.
const NOT_INCHES = String.raw`(?!\s*(?:"|\u201d|\u2033|''|in\b))`;
const SCALE_PATTERNS = [
  new RegExp(String.raw`(?:schaal|scale|maatstaf|maßstab|ma(?:ss|ß)stab|échelle|escala|scala|m)\s*[:=.]?\s*1\s*[:/]\s*(\d+)\b` + NOT_INCHES, 'i'),
  new RegExp(String.raw`\b1\s*[:/]\s*(\d+)\b` + NOT_INCHES, 'i'),
];

// Architectural / engineering scales: 1/4" = 1'-0", 1-1/2" = 1'-0", 1" = 20'.
// Paper inches (whole, fraction or both) = real feet (and inches).
const INCH = String.raw`(?:"|\u201d|\u2033|''|in\b)`;
const FOOT = String.raw`(?:'|\u2019|\u2032|ft\b)`;
const IMPERIAL_SCALE = new RegExp(
  String.raw`(?:(\d+)\s*[- ]\s*)?(?:(\d+)\s*\/\s*(\d+)|(\d+))\s*${INCH}\s*=\s*(\d+)\s*${FOOT}(?:\s*-?\s*(\d+)\s*${INCH})?`, 'i');

function matchImperialScale(text) {
  const m = text.match(IMPERIAL_SCALE);
  if (!m) return null;
  const [, whole, num, den, plain, feet, inches] = m;
  const paper = plain != null ? Number(plain) : (Number(whole || 0) + Number(num) / Number(den));
  const real = Number(feet) * 12 + Number(inches || 0);
  if (!(paper > 0) || !(real > 0)) return null;
  const ratio = Math.round((real / paper) * 1000) / 1000;
  return ratio > 0 && ratio <= 10000 ? { ratio, scaleText: m[0].trim(), imperial: true } : null;
}

function matchScale(text) {
  const imperial = matchImperialScale(text);
  if (imperial) return imperial;
  for (const pattern of SCALE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const ratio = parseInt(match[1], 10);
      if (ratio > 0 && ratio <= 10000) {
        return { ratio, scaleText: match[0].trim() };
      }
    }
  }
  return null;
}

/**
 * Find a drawing scale such as "1:100", "SCHAAL 1:50", "SCALE: 1:200" or
 * "M 1:500" in the text items of a page.
 * @param {Array<{str: string}>} items - PDF.js text content items
 * @returns {{ ratio: number, scaleText: string } | null}
 */
export function findScaleInText(items) {
  const list = Array.isArray(items) ? items : [];

  // First pass: check the concatenated text of all items
  const found = matchScale(list.map(item => item.str).join(' '));
  if (found) return found;

  // Second pass: check individual text items for better accuracy
  // (sometimes the scale sits in a single text element in the title block)
  for (const item of list) {
    const str = (item.str || '').trim();
    if (!str) continue;
    const single = matchScale(str);
    if (single) return single;
  }

  return null;
}

/**
 * Detect the scale from the text of a page of THIS document.
 * @param {object} doc - the document to read (needs doc.pdfDoc)
 * @param {number} [pageNum] - page to read; defaults to doc.currentPage
 * @returns {Promise<{ ratio: number, scaleText: string } | null>}
 */
export async function detectScaleInDocument(doc, pageNum) {
  if (!doc?.pdfDoc) return null;

  const page = await doc.pdfDoc.getPage(pageNum || doc.currentPage);
  // The text layer reads the same page: one PDF.js request for both.
  const textContent = await pageTextContent(page);
  return findScaleInText(textContent.items);
}

/**
 * The document-level measureScale that belongs to a scaleBar annotation,
 * or null when the scale bar carries no usable calibration.
 */
export function scaleFromScaleBar(scaleBar) {
  if (!scaleBar) return null;
  if (!geldigeSchaal(scaleBar)) return null;
  return {
    pixelsPerUnit: scaleBar.pixelsPerUnit,
    unit: scaleBar.unit || 'mm',
    method: 'scaleBar',
    scaleRatio: 0,
  };
}
