// App models for annotations in PDF bytes, through the same conversion the
// loader uses (loader/convert-page.js). Unflatten uses it for the restored
// markups only; the node tests use it to reopen a saved file.
import { PDFDocument } from 'pdf-lib';
import { extractAnnotationColors } from './loader/color-extraction.js';
import { extractStampImagesHybrid } from './loader/image-extraction.js';
import { convertAndPushAnnotations } from './loader/convert-page.js';

/**
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {Map<number, Set<string>>} [options.only] page → pdf.js annotation
 *   ids to convert (all annotations of every page when absent)
 * @param {object[]} [options.existing] models already in the document: new
 *   durable IDs are kept unique against them
 * @param {object} [options.pdfjsOptions] extra pdf.js getDocument options
 * @returns {Promise<object[]>} the new models, in page order
 */
export async function modelsFromPdf(bytes, { only = null, existing = [], pdfjsOptions = {} } = {}) {
  const pdfjs = await import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0, ...pdfjsOptions });
  const pdf = await task.promise;
  const scratch = { annotations: existing.slice() };
  try {
    const lib = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true, updateMetadata: false });
    const pageNums = only ? [...only.keys()].sort((a, b) => a - b) : [...Array(pdf.numPages)].map((_, i) => i + 1);
    for (const pageNum of pageNums) {
      if (pageNum < 1 || pageNum > pdf.numPages) continue;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const wanted = only?.get(pageNum);
      const annots = (await page.getAnnotations()).filter(a => !wanted || wanted.has(a.id));
      if (!annots.length) continue;
      let stamps = null;
      const stampAnnots = annots.filter(a => a.subtype === 'Stamp');
      if (stampAnnots.length || annots.some(a => a.subtype === 'Square')) {
        try {
          stamps = await extractStampImagesHybrid(page, viewport, stampAnnots, pageNum, lib);
        } catch (e) {
          console.warn('[flatten] stamp images not read:', e?.message || e);
        }
      }
      const colors = await extractAnnotationColors(pageNum, lib);
      await convertAndPushAnnotations(annots, pageNum, viewport, stamps || new Map(), colors, scratch);
    }
  } finally {
    await task.destroy();
  }
  return scratch.annotations.slice(existing.length);
}
