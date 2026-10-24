// Batch > Link in the open document: scan the page text for sheet numbers,
// create the chosen links as hyperlink markups (one undo step), and remove
// the links Batch Link made. See batch-link.js for the rules.

import { getActiveDocument, getPageRotation } from '../core/state.js';
import { createAnnotation } from '../annotations/factory.js';
import { recordBulkAdd } from '../core/undo-manager.js';
import { deleteAnnotationsWithUndo } from '../annotations/mutations.js';
import { planBatchLinks, batchLinkMarkup, isBatchLinkMarkup } from './batch-link.js';
import { modelViewport, textItemBox } from './region-text.js';
import { readDocumentLabels, loadAllAnnotations } from './page-labels-app.js';

async function redraw(doc) {
  const m = await import('../annotations/rendering.js');
  if (doc.viewMode === 'continuous') m.redrawContinuous();
  else m.redrawAnnotations();
}

// Width of a text in a font family, for framing a word inside a text run
// (proportional fonts: "SEE " is narrower than four capitals). Without a
// canvas the character share is used.
export function textMeasurer(fontFamily) {
  let ctx = null;
  try { ctx = document.createElement('canvas').getContext('2d'); } catch { ctx = null; }
  if (!ctx) return null;
  ctx.font = `100px ${fontFamily || 'sans-serif'}`;
  const cache = new Map();
  return (text) => {
    if (!cache.has(text)) cache.set(text, ctx.measureText(text).width);
    return cache.get(text);
  };
}

/**
 * Scan the active document. Returns the plan (batch-link.js) plus the labels
 * used, or null when the document changed during the scan.
 */
export async function scanDocumentForLinks(options = {}, onProgress) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  const pdfDoc = doc.pdfDoc;
  const labels = await readDocumentLabels(doc);
  await loadAllAnnotations(doc);
  const pages = [];
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const viewport = modelViewport(page, getPageRotation(p) || 0);
    let content = { items: [], styles: {} };
    try { content = await page.getTextContent(); } catch { /* no text */ }
    if (getActiveDocument() !== doc || doc.pdfDoc !== pdfDoc) return null;
    const measurers = new Map();
    const measureFor = (item) => {
      const family = content.styles?.[item.fontName]?.fontFamily || 'sans-serif';
      if (!measurers.has(family)) measurers.set(family, textMeasurer(family));
      return measurers.get(family);
    };
    pages.push({
      page: p,
      items: (content.items || []).filter(item => typeof item.str === 'string')
        .map(item => ({ str: item.str, box: (s, e) => textItemBox(item, viewport, s, e, measureFor(item)) })),
    });
    onProgress?.(p, pdfDoc.numPages);
  }
  const existing = (doc.annotations || []).filter(a => a.type === 'hyperlink')
    .map(a => ({ page: a.page, x: a.x, y: a.y, width: a.width, height: a.height }));
  return { labels, ...planBatchLinks(pages, labels, { ...options, existing }) };
}

/** Add the links as markups; returns how many were created. */
export async function createDocumentLinks(links, options = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || !links?.length) return 0;
  const created = links.map(link => createAnnotation(batchLinkMarkup(link, options)));
  doc.annotations.push(...created);
  recordBulkAdd(created);
  await redraw(doc);
  return created.length;
}

/** The Batch Link markups of the active document (all pages loaded first). */
export async function documentBatchLinks() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return [];
  await loadAllAnnotations(doc);
  return (doc.annotations || []).filter(isBatchLinkMarkup);
}

/** Delete every Batch Link markup as one undo step; returns the count. */
export async function removeDocumentBatchLinks() {
  const doc = getActiveDocument();
  const links = await documentBatchLinks();
  if (!doc || !links.length) return 0;
  // Links on a locked markup layer stay, as for any delete.
  const removed = deleteAnnotationsWithUndo(doc, links);
  const gone = new Set(removed);
  doc.selectedAnnotations = (doc.selectedAnnotations || []).filter(a => !gone.has(a));
  if (gone.has(doc.selectedAnnotation)) doc.selectedAnnotation = null;
  await redraw(doc);
  return removed.length;
}
