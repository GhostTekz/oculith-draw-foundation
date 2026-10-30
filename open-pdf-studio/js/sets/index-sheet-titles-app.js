import * as pdfjsLib from 'pdfjs-dist';
import { invoke, isTauri, readBinaryFile } from '../core/platform.js';
import { modelViewport } from '../pdf/region-text.js';
import { fingerprintPdfBytes } from './pdf-page-import.js';
import { indexSheetTitleSuggestions } from './index-sheet-titles.js';

/** Read one selected, fingerprinted register page without changing any source. */
export async function readIndexSheetTitles(indexSheet, sheets) {
  if (!indexSheet?.sourceSha256) throw new Error('The selected sheet has no recorded PDF fingerprint.');
  if (isTauri()) await invoke('allow_fs_scope', { path: indexSheet.filePath });
  const bytes = await readBinaryFile(indexSheet.filePath);
  if (!bytes?.length || await fingerprintPdfBytes(bytes) !== indexSheet.sourceSha256) {
    throw new Error('The selected PDF is missing or changed. Relink or record its source first.');
  }
  const task = pdfjsLib.getDocument({ data: Uint8Array.from(bytes),
    cMapUrl: '/pdfjs/web/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/', wasmUrl: '/pdfjs/web/wasm/',
    isEvalSupported: false, verbosity: 0 });
  try {
    const document = await task.promise;
    if (indexSheet.page < 1 || indexSheet.page > document.numPages) {
      throw new Error(`Page ${indexSheet.page} is no longer in the selected PDF.`);
    }
    const page = await document.getPage(indexSheet.page);
    const content = await page.getTextContent();
    return indexSheetTitleSuggestions(content.items, modelViewport(page), sheets);
  } finally { await task.destroy(); }
}
