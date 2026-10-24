// Convert an exported visual change entry into a PDF user-space region for a
// future revision markup. Compare rasterizes the NEW page with PDF.js's native
// crop and /Rotate at scale 1; its page-view coordinates have a top-left origin.
// Use that same page's inverse viewport transform instead of assuming a
// bottom-left origin or an unrotated MediaBox.

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {Object} pdfPage PDF.js page for the displayed new revision.
 * @param {{x:number,y:number,width:number,height:number}} bounds Scale-one page-view bounds.
 * @returns {{rect:[number,number,number,number],clippedToPage:boolean}}
 */
export function pageViewBoundsToPdfRect(pdfPage, bounds) {
  if (!pdfPage || typeof pdfPage.getViewport !== 'function') throw new Error('A PDF.js target page is required.');
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finite)
      || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Finite, positive page-view bounds are required.');
  }
  const viewport = pdfPage.getViewport({ scale: 1 });
  if (!finite(viewport.width) || !finite(viewport.height) || viewport.width <= 0 || viewport.height <= 0
      || typeof viewport.convertToPdfPoint !== 'function') {
    throw new Error('The target page has no usable PDF.js viewport.');
  }
  // Detection canvases use ceil(viewport size), and reported bounds are
  // rounded to 0.001 units. Clip edge regions to the actual visible CropBox.
  const left = Math.max(0, bounds.x);
  const top = Math.max(0, bounds.y);
  const right = Math.min(viewport.width, bounds.x + bounds.width);
  const bottom = Math.min(viewport.height, bounds.y + bounds.height);
  if (!(right > left && bottom > top)) throw new Error('The change region is outside the visible PDF page.');
  const clippedToPage = left !== bounds.x || top !== bounds.y
    || right !== bounds.x + bounds.width || bottom !== bounds.y + bounds.height;
  const corners = [
    viewport.convertToPdfPoint(left, top),
    viewport.convertToPdfPoint(right, top),
    viewport.convertToPdfPoint(right, bottom),
    viewport.convertToPdfPoint(left, bottom),
  ];
  if (!corners.every(point => Array.isArray(point) && point.length === 2 && point.every(finite))) {
    throw new Error('The page viewport could not map this region to PDF coordinates.');
  }
  const xs = corners.map(point => point[0]);
  const ys = corners.map(point => point[1]);
  const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (!(rect[2] > rect[0] && rect[3] > rect[1])) throw new Error('The mapped PDF region has no area.');
  return { rect, clippedToPage };
}

/**
 * Convert only a manually paired, unreviewed VISUAL change. This does not
 * create a markup or assert that the supplied page came from the expected
 * document bytes; a caller must verify that before writing to a PDF.
 */
export function visualChangeToPdfReviewRegion({ report, change, pdfPage, targetPath }) {
  if (!report || report.pairingStatus !== 'confirmed manually'
      || !report.oldPath || !report.newPath
      || !Number.isInteger(report.oldPage) || report.oldPage < 1
      || !Number.isInteger(report.newPage) || report.newPage < 1) {
    throw new Error('A manually confirmed source page pair is required.');
  }
  if (targetPath !== report.newPath || pdfPage?.pageNumber !== report.newPage) {
    throw new Error('The target PDF path and page must match the new revision.');
  }
  if (!change || change.source !== 'visual' || change.reviewState !== 'unreviewed'
      || change.pageView?.frame !== 'aligned new page'
      || !Number.isInteger(change.number) || change.number < 1
      || !['added', 'removed', 'modified'].includes(change.type)) {
    throw new Error('An unreviewed visual change in the aligned new-page frame is required.');
  }
  const { rect, clippedToPage } = pageViewBoundsToPdfRect(pdfPage, change.pageView);
  return {
    targetPath: report.newPath, targetPage: report.newPage,
    oldPath: report.oldPath, oldPage: report.oldPage,
    pairingStatus: report.pairingStatus, confirmedAt: report.confirmedAt || '',
    alignment: { ...report.alignment },
    changeNumber: change.number, changeType: change.type, source: 'visual',
    reviewState: 'unreviewed', pdfRect: rect, clippedToPage,
  };
}

function viewPair(point) {
  if (Array.isArray(point)) return [point[0], point[1]];
  if (point && typeof point === 'object') return [point.x, point.y];
  return [Number.NaN, Number.NaN];
}

function scaleOneViewport(pdfPage) {
  if (!pdfPage || typeof pdfPage.getViewport !== 'function') throw new Error('A PDF.js target page is required.');
  const viewport = pdfPage.getViewport({ scale: 1 });
  if (!finite(viewport.width) || !finite(viewport.height) || viewport.width <= 0 || viewport.height <= 0
      || typeof viewport.convertToPdfPoint !== 'function') {
    throw new Error('The target page has no usable PDF.js viewport.');
  }
  return viewport;
}

/**
 * Map one scale-one page-view outline into a PDF user-space ring.
 * Points use the same top-left, y-down viewport as pageViewBoundsToPdfRect.
 * Each point is clipped to that visible page, then mapped only with
 * convertToPdfPoint. Do not flip y again.
 * @param {Object} pdfPage PDF.js page for the displayed new revision.
 * @param {Array<{x:number,y:number}|[number,number]>} points
 * @returns {{ring:Array<[number,number]>,clippedToPage:boolean}}
 */
export function pageViewOutlineToPdfRing(pdfPage, points) {
  if (!Array.isArray(points) || points.length < 3) throw new Error('At least three page-view points are required.');
  const viewport = scaleOneViewport(pdfPage);
  const raw = points.map(viewPair);
  if (!raw.every(point => point.every(finite))) throw new Error('Finite page-view points are required.');
  const xs = raw.map(point => point[0]);
  const ys = raw.map(point => point[1]);
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.min(viewport.width, Math.max(...xs));
  const bottom = Math.min(viewport.height, Math.max(...ys));
  if (!(right > left && bottom > top)) throw new Error('The change region is outside the visible PDF page.');
  let clippedToPage = false;
  const ring = raw.map(([x, y]) => {
    const clippedX = Math.min(viewport.width, Math.max(0, x));
    const clippedY = Math.min(viewport.height, Math.max(0, y));
    if (clippedX !== x || clippedY !== y) clippedToPage = true;
    const mapped = viewport.convertToPdfPoint(clippedX, clippedY);
    if (!Array.isArray(mapped) || mapped.length < 2 || !finite(mapped[0]) || !finite(mapped[1])) {
      throw new Error('The page viewport could not map this region to PDF coordinates.');
    }
    return [mapped[0], mapped[1]];
  });
  return { ring, clippedToPage };
}

function finitePairs(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const points = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2 || !finite(point[0]) || !finite(point[1])) return null;
    points.push([point[0], point[1]]);
  }
  return points;
}

/**
 * One committed simplify of a PDF user-space ring (y up, from convertToPdfPoint).
 * Not for change detection or a pointer move. A missing invoke, a throw, or a
 * result that is not at least three finite points keeps the mapped ring.
 * @param {Array<[number,number]>} ring
 * @param {Function|undefined} invoke
 * @returns {Promise<Array<[number,number]>>}
 */
export async function cleanRevisionRing(ring, invoke) {
  const points = finitePairs(ring);
  if (typeof invoke !== 'function' || !points) return ring;
  try {
    const simplified = await invoke('geos_simplify', { points, tolerance: 0.75, closed: true });
    return finitePairs(simplified) || ring;
  } catch {
    return ring;
  }
}
