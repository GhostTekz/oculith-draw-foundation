import { state, getActiveDocument } from "../core/state.js";
import { getPdfBytes } from "./loader.js";
import { getCacheKey, reloadFromBytes } from "./page-manager.js";
import { renderPageOffscreen, parsePageRange } from "./exporter.js";
import { recordPageStructure } from "../core/undo-manager.js";
import { showLoading, hideLoading } from "../ui/chrome/dialogs.js";
import { PDFDocument } from "pdf-lib";
import { MM_TO_POINTS, contentRenderScale, contentBoundsFromPixels, applyCropBoxes } from "./crop-margins-core.js";

/**
 * Detect the content bounds of a rendered page by edge-inward pixel scanning.
 * @param {number} pageNum - 1-based page number
 * @param {number} threshold - Whiteness threshold (0-255), pixels brighter are "white"
 * @returns {Promise<{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number, scale: number} | null>}
 */
async function detectContentBounds(pageNum, threshold) {
  // Determine render scale — reduce for very large pages
  const page = await getActiveDocument().pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  const scale = contentRenderScale(vp.width, vp.height);

  const canvas = await renderPageOffscreen(pageNum, scale);
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const bounds = contentBoundsFromPixels(ctx.getImageData(0, 0, width, height).data, width, height, threshold);
  return bounds ? { ...bounds, scale } : null;
}

/**
 * Crop margins from pages in the current document.
 * @param {'current' | 'all' | 'range'} applyTo - Which pages to crop
 * @param {string} rangeStr - Page range string (only used when applyTo is 'range')
 * @param {number} paddingMm - Padding around content in mm
 * @param {number} threshold - Whiteness threshold (200-255)
 * @returns {Promise<{cropped: number, skipped: number}>}
 */
export async function cropMargins(applyTo, rangeStr, paddingMm, threshold) {
  if (!getActiveDocument()?.pdfDoc) return { cropped: 0, skipped: 0 };

  const cacheKey = getCacheKey();
  const currentBytes = await getPdfBytes(cacheKey);
  if (!currentBytes) return { cropped: 0, skipped: 0 };

  const doc = getActiveDocument();
  const oldAnnotations = doc.annotations.map((a) => ({ ...a }));
  const oldRotations = { ...doc.pageRotations };
  const oldPage = doc.currentPage;

  // Determine which pages to process
  const totalPages = doc.pdfDoc.numPages;
  let pageNumbers;
  if (applyTo === "current") {
    pageNumbers = [doc.currentPage];
  } else if (applyTo === "all") {
    pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    pageNumbers = parsePageRange(rangeStr, totalPages);
  }

  if (pageNumbers.length === 0) return { cropped: 0, skipped: 0 };

  const paddingPt = paddingMm * MM_TO_POINTS;

  showLoading("Detecting content bounds...");
  try {
    // First pass: detect bounds for all pages
    const boundsMap = new Map();
    for (const pageNum of pageNumbers) {
      showLoading(`Analyzing page ${pageNum} of ${totalPages}...`);
      const bounds = await detectContentBounds(pageNum, threshold);
      if (bounds) {
        boundsMap.set(pageNum, bounds);
      }
    }

    if (boundsMap.size === 0) {
      return { cropped: 0, skipped: pageNumbers.length };
    }

    // Second pass: apply CropBox via pdf-lib
    showLoading("Applying crop...");
    const pdfDoc = await PDFDocument.load(currentBytes, {
      ignoreEncryption: true,
    });
    const pages = pdfDoc.getPages();

    applyCropBoxes(pages, boundsMap, paddingPt);

    const newBytes = new Uint8Array(await pdfDoc.save());

    // Annotations and rotations stay the same — CropBox doesn't change page structure
    const newAnnotations = oldAnnotations;
    const newRotations = { ...oldRotations };
    const targetPage = doc.currentPage;

    await reloadFromBytes(newBytes, newAnnotations, newRotations, targetPage);
    recordPageStructure(
      currentBytes,
      oldAnnotations,
      oldRotations,
      oldPage,
      newBytes,
      newAnnotations,
      newRotations,
      targetPage
    );

    return {
      cropped: boundsMap.size,
      skipped: pageNumbers.length - boundsMap.size,
    };
  } finally {
    hideLoading();
  }
}
