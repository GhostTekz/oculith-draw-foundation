// Reduce File Size, the part without the app (see compress.js for the why):
// every page rendered at the target DPI, re-encoded as JPEG, and placed on a
// page of the original size in a fresh PDF. Document ▸ Reduce File Size
// renders the open document; Batch ▸ Reduce File Size (js/batch/ops.js)
// renders a file from disk. The caller passes the render and encode steps.
import { PDFDocument } from 'pdf-lib';

// Quality presets. Each maps to a render resolution (DPI) and a JPEG quality.
// Lower DPI + lower quality => smaller file, less detail.
export const COMPRESS_PRESETS = {
  low: { dpi: 100, quality: 0.55 },     // smallest file
  medium: { dpi: 150, quality: 0.72 },  // balanced (default)
  high: { dpi: 200, quality: 0.85 },    // best quality
};

/** pdf-lib save options of a reduced file. */
export const COMPRESS_SAVE_OPTIONS = Object.freeze({ useObjectStreams: true });

/**
 * @param {object} options
 * @param {number} options.pageCount
 * @param {number} options.dpi
 * @param {number} options.quality - JPEG quality 0..1
 * @param {(pageNum:number, scale:number) => Promise<any>} options.renderPage - a canvas
 * @param {(canvas:any, quality:number) => Promise<Uint8Array>} options.toJpeg
 * @param {(pageNum:number) => Promise<{width:number, height:number}>} options.pageSize - in points, as displayed
 * @param {(pageNum:number) => void} [options.onPage]
 * @param {() => void} [options.checkCancelled] - throws to stop between pages
 * @returns {Promise<PDFDocument>}
 */
export async function buildRasterPdf({ pageCount, dpi, quality, renderPage, toJpeg, pageSize, onPage = () => {}, checkCancelled = () => {} }) {
  const exportScale = dpi / 72;
  const newPdf = await PDFDocument.create();

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    checkCancelled();
    onPage(pageNum);

    // Render the page at the target DPI, then re-encode as JPEG — this is
    // where the downsampling happens.
    const canvas = await renderPage(pageNum, exportScale);
    checkCancelled();
    const jpegBytes = await toJpeg(canvas, quality);
    const jpegImage = await newPdf.embedJpg(jpegBytes);

    const { width, height } = await pageSize(pageNum);
    const page = newPdf.addPage([width, height]);
    page.drawImage(jpegImage, { x: 0, y: 0, width, height });
  }
  return newPdf;
}
