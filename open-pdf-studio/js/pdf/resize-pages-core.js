// Page Setup (page size), the pdf-lib part: Document ▸ Page Setup
// (resize-pages.js) and Batch ▸ Crop & Page Setup (js/batch/ops.js) both
// set the boxes here. No app imports, so node tests run it on real bytes.

export const PAGE_MM_TO_POINTS = 72 / 25.4;

// Preset sizes in millimetres (portrait: width x height).
export const PAGE_SIZE_PRESETS = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  tabloid: [279.4, 431.8],
};

/** Target size in mm: a preset (or 'custom' with `custom` [w, h]) in an orientation. */
export function pageSizeMm(preset, orientation = 'portrait', custom = [210, 297]) {
  let [w, h] = preset === 'custom' ? custom.map(Number) : (PAGE_SIZE_PRESETS[preset] || PAGE_SIZE_PRESETS.a4);
  if (orientation === 'landscape' && h > w) [w, h] = [h, w];
  if (orientation === 'portrait' && w > h) [w, h] = [h, w];
  return { w, h };
}

/**
 * Resize the media/document size of pages WITHOUT scaling their content.
 * The MediaBox and CropBox are both set to the requested size, centred on the
 * current CropBox, so the content and the annotations (absolute PDF
 * coordinates) stay where they are on the page.
 *
 * @param {import('pdf-lib').PDFPage[]} pages
 * @param {Iterable<number>} pageNumbers - 1-based
 * @param {number} targetWpt - Target visual width in points
 * @param {number} targetHpt - Target visual height in points
 * @param {Record<number, number>} [appRotations] - in-app rotation per page
 * @returns {Map<number, {dx:number, dy:number}>} per page, the offset of the
 *   content in visual space (the app shifts its markup models by it)
 */
export function resizePdfLibPages(pages, pageNumbers, targetWpt, targetHpt, appRotations = {}) {
  const pageOffsets = new Map();

  for (const pageNum of pageNumbers) {
    const pdfPage = pages[pageNum - 1];
    if (!pdfPage) continue;

    const crop = pdfPage.getCropBox();
    // Total displayed rotation = native /Rotate + any in-app rotation.
    const nativeRot = pdfPage.getRotation().angle % 360;
    const appRot = (appRotations[pageNum] || 0) % 360;
    const rot = (((nativeRot + appRot) % 360) + 360) % 360;
    const rotated = rot === 90 || rot === 270;

    // Visual (as-displayed) dimensions of the current page.
    const visualOldW = rotated ? crop.height : crop.width;
    const visualOldH = rotated ? crop.width : crop.height;

    // New box in unrotated PDF space (swap dims for quarter-turn pages so
    // the *visual* result matches what the user typed).
    const unrotW = rotated ? targetHpt : targetWpt;
    const unrotH = rotated ? targetWpt : targetHpt;

    // Centre the new box on the current content centre.
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    const newX = centerX - unrotW / 2;
    const newY = centerY - unrotH / 2;

    pdfPage.setMediaBox(newX, newY, unrotW, unrotH);
    pdfPage.setCropBox(newX, newY, unrotW, unrotH);

    // Content moved by half the size delta (in visual space); annotations follow.
    pageOffsets.set(pageNum, {
      dx: (targetWpt - visualOldW) / 2,
      dy: (targetHpt - visualOldH) / 2,
    });
  }
  return pageOffsets;
}
