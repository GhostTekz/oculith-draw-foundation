// "PDF comprimeren" — reduces the file size of a PDF by rasterising every page
// to a downsampled JPEG at a chosen resolution/quality and rebuilding a fresh
// PDF from those images. This is the reliable size-reduction path for scanned
// or image-heavy drawings in this stack:
//
//   * Image downsampling/recompression happens implicitly: each page is
//     re-rendered at the target DPI and re-encoded as JPEG, so a 600-DPI scan
//     collapses to (say) 150 DPI at a fraction of the bytes.
//   * Unused objects are dropped for free: the output is a brand-new
//     PDFDocument.create(), so orphaned streams, dead fonts and duplicate
//     resources from the source never make it across.
//
// Trade-off (documented on purpose): rasterising flattens the page, so text
// becomes non-searchable and vector line-work is baked into the JPEG. That is
// the accepted behaviour for a "make this scan smaller" action and mirrors the
// existing raster-PDF export. Font subsetting is therefore not applicable to
// this path (there are no fonts left to subset); a text-preserving optimiser
// that only recompresses embedded image XObjects is noted as a follow-up.
//
// The result is always written to a NEW file via a save-as dialog, so the
// original document on disk is never touched.
import { getActiveDocument, state, getPageRotation } from '../core/state.js';
import { isTauri, saveFileDialog, writeBinaryFile } from '../core/platform.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { renderPageOffscreen, canvasToBytes } from './exporter.js';
import { getPdfByteLength } from './loader.js';
import { getCacheKey } from './page-manager.js';
import { COMPRESS_PRESETS, COMPRESS_SAVE_OPTIONS, buildRasterPdf } from './compress-core.js';
import i18next from '../i18n/config.js';

// Quality presets: compress-core.js (shared with Batch ▸ Reduce File Size).
export { COMPRESS_PRESETS };

/** Human-readable byte size (e.g. 24.8 MB). */
export function formatBytes(bytes) {
  if (bytes == null || !isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
}

/** Size of the currently loaded document in bytes (annotations included). */
export function getCurrentDocumentSize() {
  try {
    return getPdfByteLength(getCacheKey());
  } catch {
    return null;
  }
}

function getPdfBaseName() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return 'document';
  const fileName = doc.fileName || 'document';
  return fileName.replace(/\.pdf$/i, '');
}

/**
 * Compress the active document and write the result to a new file.
 *
 * @param {Object} options
 * @param {'low'|'medium'|'high'} [options.level='medium'] - Quality preset.
 * @param {number} [options.dpi] - Explicit target DPI (overrides the preset).
 * @param {number} [options.quality] - Explicit JPEG quality 0..1 (overrides preset).
 * @returns {Promise<null | {outputPath: string, origSize: number|null, newSize: number, dpi: number, quality: number, pages: number}>}
 *          null when there is nothing to do or the user cancelled the save dialog.
 */
export async function compressPDF({ level = 'medium', dpi, quality } = {}) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  if (!isTauri()) return null;

  const preset = COMPRESS_PRESETS[level] || COMPRESS_PRESETS.medium;
  const targetDpi = dpi ?? preset.dpi;
  const jpegQuality = quality ?? preset.quality;

  const origSize = getCurrentDocumentSize();

  const baseName = getPdfBaseName();
  const suffix = i18next.t('compress.fileSuffix', { ns: 'dialogs' });
  const outputPath = await saveFileDialog(`${baseName}${suffix}.pdf`, [
    { name: 'PDF Files', extensions: ['pdf'] },
  ]);
  if (!outputPath) return null;

  const totalPages = doc.pdfDoc.numPages;
  showLoading(i18next.t('compress.progressPreparing', { ns: 'dialogs' }));

  try {
    const newPdf = await buildRasterPdf({
      pageCount: totalPages, dpi: targetDpi, quality: jpegQuality,
      onPage: (pageNum) => showLoading(i18next.t('compress.progressPage', { ns: 'dialogs', page: pageNum, total: totalPages })),
      // Re-render the page (with any annotations baked in) at the target DPI.
      renderPage: (pageNum, scale) => renderPageOffscreen(pageNum, scale),
      toJpeg: (canvas, q) => canvasToBytes(canvas, 'jpeg', q),
      pageSize: async (pageNum) => {
        // Keep the original page size in PDF points so the geometry is unchanged.
        const origPage = await doc.pdfDoc.getPage(pageNum);
        const extraRotation = getPageRotation(pageNum);
        const origViewportOpts = { scale: 1 };
        if (extraRotation) {
          origViewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
        }
        return origPage.getViewport(origViewportOpts);
      },
    });

    // Fresh document => no orphaned/unused objects carried over.
    const newBytes = await newPdf.save(COMPRESS_SAVE_OPTIONS);
    await writeBinaryFile(outputPath, newBytes);

    return {
      outputPath,
      origSize,
      newSize: newBytes.length,
      dpi: targetDpi,
      quality: jpegQuality,
      pages: totalPages,
    };
  } finally {
    hideLoading();
  }
}
