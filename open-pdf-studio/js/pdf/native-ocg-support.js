// Whether a PDF's layers can be switched in the view. PDFium shows a layer
// view through a temporary in-memory copy whose default configuration lists
// the chosen layers (ocg-render-copy); that copy supports ordinary catalog
// layers only. This reads the same structure with pdf-lib, before a change,
// so the Layers panel can disable its toggles with the reason instead of
// letting every render fail (docs/foundation/PDF-LAYERS.md). The checks
// mirror ocg-render-copy/src/lib.rs; keep the two in step.
//
// Pure: a parsed pdf-lib document in, plain data out.

import { PDFArray, PDFDict, PDFName, PDFRef } from 'pdf-lib';

/** Why a view cannot be shown; each has a `leftPanel.pdfLayerUnsupported.<reason>` text. */
export const OCG_UNSUPPORTED_REASONS = Object.freeze([
  'encrypted', 'indirectProperties', 'configs', 'indirectDefault', 'autoState', 'radioGroups', 'locked',
  'baseState', 'malformed',
]);

const no = reason => ({ supported: false, reason });

/**
 * `{ supported: true }`, or `{ supported: false, reason }` with a reason
 * from OCG_UNSUPPORTED_REASONS. A PDF without layers is supported (there is
 * nothing to switch).
 */
export function ocgRenderSupport(pdfLibDoc) {
  const context = pdfLibDoc?.context;
  if (!context) return no('malformed');
  if (pdfLibDoc.isEncrypted || context.trailerInfo?.Encrypt) return no('encrypted');
  const catalog = context.lookup(context.trailerInfo?.Root);
  if (!(catalog instanceof PDFDict)) return no('malformed');
  const raw = catalog.get(PDFName.of('OCProperties'));
  if (!raw) return { supported: true };
  if (raw instanceof PDFRef) return no('indirectProperties');
  if (!(raw instanceof PDFDict)) return no('malformed');
  if (raw.has(PDFName.of('Configs'))) return no('configs');
  const groups = raw.get(PDFName.of('OCGs'));
  if (!(groups instanceof PDFArray) || !groups.asArray().every(item => item instanceof PDFRef)) return no('malformed');
  const config = raw.get(PDFName.of('D'));
  if (config instanceof PDFRef) return no('indirectDefault');
  if (!(config instanceof PDFDict)) return no('malformed');
  if (config.has(PDFName.of('AS'))) return no('autoState');
  if (config.has(PDFName.of('RBGroups'))) return no('radioGroups');
  if (config.has(PDFName.of('Locked'))) return no('locked');
  const base = config.get(PDFName.of('BaseState'));
  if (base !== undefined) {
    if (!(base instanceof PDFName)) return no('malformed');
    if (base !== PDFName.of('ON') && base !== PDFName.of('OFF')) return no('baseState');
  }
  for (const key of ['ON', 'OFF']) {
    const list = config.get(PDFName.of(key));
    if (list !== undefined && !(list instanceof PDFArray)) return no('malformed');
  }
  return { supported: true };
}
