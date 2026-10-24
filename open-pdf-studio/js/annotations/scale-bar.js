import { createAnnotation } from './factory.js';
import { getActiveDocument } from '../core/state.js';
import { detectScaleInDocument, scaleFromScaleBar } from './document-scale.js';
import { schaalOpPuntUitBronnen, paginaOfDocumentSchaal } from './schaal-op-punt.js';
import { schaalBronnen } from './schaal-bronnen.js';

const MILLIMETERS_PER_UNIT = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/**
 * Create a scale bar annotation at the given position.
 * Uses the calibration of the current page (or the document fallback). A visual default width must never
 * become a physical scale source for an uncalibrated drawing.
 */
export function createScaleBar(x, y) {
  const doc = getActiveDocument();
  const ms = paginaOfDocumentSchaal(doc, doc?.currentPage || 1);
  if (!Number.isFinite(ms?.pixelsPerUnit) || ms.pixelsPerUnit <= 0) return null;
  const unit = ms?.unit || 'mm';
  const millimetersPerUnit = MILLIMETERS_PER_UNIT[unit];
  if (!millimetersPerUnit) return null;

  // Default: a physical 5 m bar, expressed in the calibration's own unit.
  // The stored length and width must agree: width / pixelsPerUnit = totalUnits.
  const totalUnits = 5000 / millimetersPerUnit;
  const divisions = 5;

  const pixelsPerUnit = ms.pixelsPerUnit;
  const barWidth = totalUnits * pixelsPerUnit;
  if (!Number.isFinite(barWidth) || barWidth <= 0) return null;

  const barHeight = 14;

  return createAnnotation({
    type: 'scaleBar',
    page: doc?.currentPage || 1,
    x, y,
    width: barWidth,
    height: barHeight,
    rotation: 0,
    pixelsPerUnit,
    unit,
    divisions,
    totalUnits,
    color: '#000000',
    lineWidth: 1,
    opacity: 1,
  });
}

/**
 * Get the effective scale for a specific point on a specific page of the
 * active document: viewport annotation → scale bar on the page → viewport
 * from the PDF itself (/VP) → page scale → doc.measureScale → scale bar
 * elsewhere. The
 * order lives in schaal-op-punt.js; this is the shared entry point for
 * getMeasureScale and the light scale bridges (stamps, systeemraster, …).
 * Returns null when nothing is known.
 *
 * Inside a pass (schaal-bronnen.js metSchaalBronnen) the scale sources of the
 * document are collected once and shared, so a loop over all annotations
 * stays linear (#491); outside a pass they are collected fresh per call.
 */
export function getScaleForPoint(pageNum, x, y) {
  const doc = getActiveDocument();
  if (!doc) return null;
  return schaalOpPuntUitBronnen(schaalBronnen(doc), doc, pageNum, x, y);
}

/**
 * Try to detect the scale from the PDF's text content (title block).
 * Looks for patterns like "1:100", "SCHAAL 1:50", "SCALE: 1:200", "M 1:500".
 * Returns { ratio: number, scaleText: string } or null if not found.
 *
 * Reads the given document, or the active one when none is given. A caller
 * that works on a specific document (loadPDF, which also runs for background
 * tabs) MUST pass it: the active document can be a different PDF.
 */
export async function detectScaleFromPdf(pageNum, doc) {
  return detectScaleInDocument(doc || getActiveDocument(), pageNum);
}

/**
 * Sync the document-level measureScale from a scaleBar annotation.
 * Called after placing or modifying a scaleBar so that doc.measureScale
 * stays in sync and legacy code paths that read doc.measureScale still work.
 *
 * Writes to the given document, or to the active one when none is given
 * (placing/editing a scale bar always happens in the active document).
 */
export function syncDocScale(scaleBar, doc) {
  if (!doc) doc = getActiveDocument();
  if (!doc) return;
  const scale = scaleFromScaleBar(scaleBar);
  if (scale) doc.measureScale = scale;
}
