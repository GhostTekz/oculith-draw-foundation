import { getActiveDocument } from '../../core/state.js';
import { PDFName, PDFHexString } from 'pdf-lib';
// The key and the reader live in style-presets-read.js: the pdf-lib worker
// reads them without the app state this writer uses.
import { STYLE_PRESETS_CATALOG_KEY } from './style-presets-read.js';

/**
 * Persistence of named line-style presets INSIDE the PDF.
 *
 * The presets array (see js/solid/stores/stylePresetsStore.js) is stored as
 * JSON in a document-level catalog entry, following the same pattern as the
 * other OPS_* custom keys the app already writes (annotation-level
 * OPS_Subtype etc., and /Outlines on the catalog for bookmarks):
 *
 *   /Root (catalog) -> /OPS_StylePresets (hex string, UTF-16 JSON)
 *
 * PDFHexString.fromText is used instead of PDFString.of because JSON can
 * contain characters (parentheses, backslashes, non-ASCII names) that
 * literal PDF strings do not escape reliably.
 */

export { STYLE_PRESETS_CATALOG_KEY, readStylePresetsFromCatalog } from './style-presets-read.js';

/**
 * Write the active document's presets into the pdf-lib document's catalog.
 * Deletes the entry when there are no presets. Pass `presetsArg` to bypass
 * the active document (used by tests).
 */
export function saveStylePresetsToCatalog(pdfDocLib, presetsArg) {
  const presets = presetsArg !== undefined
    ? presetsArg
    : (getActiveDocument()?.stylePresets || null);
  const context = pdfDocLib.context;
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!catalog) return;

  if (!presets || presets.length === 0) {
    catalog.delete(PDFName.of(STYLE_PRESETS_CATALOG_KEY));
    return;
  }
  catalog.set(
    PDFName.of(STYLE_PRESETS_CATALOG_KEY),
    PDFHexString.fromText(JSON.stringify(presets))
  );
}
