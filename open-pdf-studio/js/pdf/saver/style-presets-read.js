import { PDFName, PDFString, PDFHexString } from 'pdf-lib';

// Reading the named line-style presets out of the PDF catalog (see
// style-presets.js for the format). No app state, so the pdf-lib worker
// (pdf/pdf-lib-worker.js) runs it too.

export const STYLE_PRESETS_CATALOG_KEY = 'OPS_StylePresets';

/**
 * Read presets back from a pdf-lib document's catalog.
 * Returns [] when absent or malformed. Entries are sanity-checked
 * (must have a string name and a props object).
 */
export function readStylePresetsFromCatalog(pdfDocLib) {
  try {
    const context = pdfDocLib.context;
    const catalog = context.lookup(context.trailerInfo.Root);
    if (!catalog) return [];
    const raw = catalog.lookup(PDFName.of(STYLE_PRESETS_CATALOG_KEY));
    let text = null;
    if (raw instanceof PDFHexString) {
      text = raw.decodeText();
    } else if (raw instanceof PDFString) {
      text = raw.decodeText();
    }
    if (!text) return [];
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.filter(p =>
      p && typeof p === 'object' &&
      typeof p.name === 'string' && p.name.length > 0 &&
      p.props && typeof p.props === 'object'
    ).map(p => ({
      id: typeof p.id === 'string' && p.id ? p.id : `sp_${Math.random().toString(36).slice(2, 10)}`,
      name: p.name,
      props: p.props,
    }));
  } catch {
    return [];
  }
}
