// Extract Pages, the pdf-lib part: Document ▸ Extract Pages (page-manager.js)
// and Batch ▸ Split (js/batch/ops.js) copy pages into a new PDF with this.
import { PDFDocument } from 'pdf-lib';

/** A new PDF with `pageNumbers` (1-based, in this order) of `srcDoc`. */
export async function extractPdfLibPages(srcDoc, pageNumbers) {
  const extractDoc = await PDFDocument.create();
  const indices = pageNumbers.map(p => p - 1);
  const copiedPages = await extractDoc.copyPages(srcDoc, indices);
  for (const page of copiedPages) {
    extractDoc.addPage(page);
  }
  return extractDoc;
}
