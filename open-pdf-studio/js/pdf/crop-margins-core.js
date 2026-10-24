// Crop margins, the part without the app: the render scale, the pixel scan
// for content bounds and the CropBox it gives. Document ▸ Crop Pages
// (crop-margins.js) renders the open document; Batch ▸ Crop & Page Setup
// (js/batch/ops.js) renders a file from disk. Both go through these.

export const ALPHA_THRESHOLD = 10;
export const MAX_PIXELS = 20_000_000;
export const MM_TO_POINTS = 72 / 25.4;

/** The render scale for the content scan of a page of `width` × `height` pt. */
export function contentRenderScale(width, height) {
  const basePixels = width * height;
  if (basePixels > MAX_PIXELS) return Math.sqrt(MAX_PIXELS / basePixels);
  // Use scale 2 for small pages to get better accuracy
  if (basePixels * 4 <= MAX_PIXELS) return 2;
  return 1;
}

/**
 * Content bounds of RGBA pixels by edge-inward scanning.
 * @param {Uint8ClampedArray|Uint8Array} data - RGBA, row by row
 * @param {number} width
 * @param {number} height
 * @param {number} threshold - Whiteness threshold (0-255), pixels brighter are "white"
 * @returns {{minX:number, minY:number, maxX:number, maxY:number, width:number, height:number} | null}
 *   null for a fully white page
 */
export function contentBoundsFromPixels(data, width, height, threshold) {
  /**
   * Check if a pixel at (x, y) is "content" (non-white).
   */
  function isContent(x, y) {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    return a >= ALPHA_THRESHOLD && (r < threshold || g < threshold || b < threshold);
  }

  // Scan rows from top to find first content row
  let minY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isContent(x, y)) {
        minY = y;
        break;
      }
    }
    if (minY !== -1) break;
  }

  // Fully white page
  if (minY === -1) return null;

  // Scan rows from bottom to find last content row
  let maxY = minY;
  for (let y = height - 1; y > minY; y--) {
    let found = false;
    for (let x = 0; x < width; x++) {
      if (isContent(x, y)) {
        maxY = y;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Scan columns from left (only between minY..maxY)
  let minX = width;
  for (let x = 0; x < width; x++) {
    let found = false;
    for (let y = minY; y <= maxY; y++) {
      if (isContent(x, y)) {
        minX = x;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  // Scan columns from right (only between minY..maxY)
  let maxX = minX;
  for (let x = width - 1; x > minX; x--) {
    let found = false;
    for (let y = minY; y <= maxY; y++) {
      if (isContent(x, y)) {
        maxX = x;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  return { minX, minY, maxX, maxY, width, height };
}

/**
 * Compute a PDF CropBox from pixel bounds, accounting for page rotation.
 * @param {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}} bounds
 * @param {import('pdf-lib').PDFPage} pdfPage - The pdf-lib page
 * @param {number} paddingPt - Padding in PDF points
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function computeCropBox(bounds, pdfPage, paddingPt) {
  const mediaBox = pdfPage.getMediaBox();
  const rotation = pdfPage.getRotation().angle % 360;

  // Convert pixel bounds to fractional positions (0..1)
  const fracLeft = bounds.minX / bounds.width;
  const fracRight = bounds.maxX / bounds.width;
  const fracTop = bounds.minY / bounds.height;
  const fracBottom = bounds.maxY / bounds.height;

  let cropX, cropY, cropW, cropH;

  if (rotation === 0) {
    // Canvas: origin top-left, Y down. PDF: origin bottom-left, Y up
    cropX = mediaBox.x + fracLeft * mediaBox.width;
    cropY = mediaBox.y + (1 - fracBottom) * mediaBox.height;
    cropW = (fracRight - fracLeft) * mediaBox.width;
    cropH = (fracBottom - fracTop) * mediaBox.height;
  } else if (rotation === 90) {
    // 90° rotation: canvas X maps to PDF Y, canvas Y maps to PDF X (inverted)
    cropX = mediaBox.x + fracTop * mediaBox.width;
    cropY = mediaBox.y + fracLeft * mediaBox.height;
    cropW = (fracBottom - fracTop) * mediaBox.width;
    cropH = (fracRight - fracLeft) * mediaBox.height;
  } else if (rotation === 180) {
    // 180° rotation: both axes inverted
    cropX = mediaBox.x + (1 - fracRight) * mediaBox.width;
    cropY = mediaBox.y + fracTop * mediaBox.height;
    cropW = (fracRight - fracLeft) * mediaBox.width;
    cropH = (fracBottom - fracTop) * mediaBox.height;
  } else if (rotation === 270) {
    // 270° rotation: canvas X maps to PDF Y (inverted), canvas Y maps to PDF X
    cropX = mediaBox.x + (1 - fracBottom) * mediaBox.width;
    cropY = mediaBox.y + (1 - fracRight) * mediaBox.height;
    cropW = (fracBottom - fracTop) * mediaBox.width;
    cropH = (fracRight - fracLeft) * mediaBox.height;
  } else {
    // Fallback: treat as 0°
    cropX = mediaBox.x + fracLeft * mediaBox.width;
    cropY = mediaBox.y + (1 - fracBottom) * mediaBox.height;
    cropW = (fracRight - fracLeft) * mediaBox.width;
    cropH = (fracBottom - fracTop) * mediaBox.height;
  }

  // Apply padding
  cropX -= paddingPt;
  cropY -= paddingPt;
  cropW += 2 * paddingPt;
  cropH += 2 * paddingPt;

  // Clamp to MediaBox
  cropX = Math.max(mediaBox.x, cropX);
  cropY = Math.max(mediaBox.y, cropY);
  cropW = Math.min(cropW, mediaBox.x + mediaBox.width - cropX);
  cropH = Math.min(cropH, mediaBox.y + mediaBox.height - cropY);

  return { x: cropX, y: cropY, width: cropW, height: cropH };
}

/** Set the CropBox of each page in `boundsMap` (1-based page → bounds). */
export function applyCropBoxes(pages, boundsMap, paddingPt) {
  for (const [pageNum, bounds] of boundsMap) {
    const pdfPage = pages[pageNum - 1];
    const crop = computeCropBox(bounds, pdfPage, paddingPt);
    pdfPage.setCropBox(crop.x, crop.y, crop.width, crop.height);
  }
}
