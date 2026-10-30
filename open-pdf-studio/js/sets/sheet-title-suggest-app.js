import * as pdfjsLib from 'pdfjs-dist';
import { invoke, isTauri, readBinaryFile } from '../core/platform.js';
import { modelViewport } from '../pdf/region-text.js';
import { fingerprintPdfBytes } from './pdf-page-import.js';
import { suggestSheetDetails } from './sheet-title-suggest.js';

/** Read one registered source page without changing the PDF or drawing set. */
export async function suggestDetailsForSheet(sheet) {
  if (isTauri()) await invoke('allow_fs_scope', { path: sheet.filePath });
  const bytes = await readBinaryFile(sheet.filePath);
  if (!bytes?.length) throw new Error('The registered PDF could not be read.');
  if (sheet.sourceSha256 && await fingerprintPdfBytes(bytes) !== sheet.sourceSha256) {
    throw new Error('The registered PDF changed. Record or relink its source before reading suggestions.');
  }
  // PDF.js transfers the input buffer to a worker. Preserve the platform cache.
  const task = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    cMapUrl: '/pdfjs/web/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    wasmUrl: '/pdfjs/web/wasm/', isEvalSupported: false, verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (sheet.page > document.numPages) throw new Error(`Page ${sheet.page} is no longer in the registered PDF.`);
    const page = await document.getPage(sheet.page);
    const content = await page.getTextContent();
    return suggestSheetDetails(content.items, modelViewport(page));
  } finally {
    await task.destroy();
  }
}
