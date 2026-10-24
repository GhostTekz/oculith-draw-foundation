// PDF persistence of assemblies (assemblies.js).
//
//   Catalog /OPS_AssembliesV1   JSON { v, recipes }
//
// The PDF is untrusted input: the key is bounded before decoding and
// validated after. A malformed value reads as absent.

import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import {
  assembliesModel, isEmptyAssemblies, ASSEMBLY_JSON_MAX,
} from '../annotations/assemblies.js';

export const ASSEMBLIES_KEY = 'OPS_AssembliesV1';

/** The document model from the catalog, or null when absent or malformed. */
export function readAssemblies(pdf) {
  try {
    const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
    const raw = catalog?.lookup(PDFName.of(ASSEMBLIES_KEY));
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)
        || raw.value.length > (ASSEMBLY_JSON_MAX + 1) * 4) return null;
    const json = raw.decodeText();
    if (json.length > ASSEMBLY_JSON_MAX) return null;
    const model = assembliesModel(JSON.parse(json));
    return isEmptyAssemblies(model) ? null : model;
  } catch { return null; }
}

/**
 * The model to save: the document's (once read or edited) else what the
 * source PDF holds, so a save before the async read keeps it.
 */
export function assembliesForSave(doc, sourcePdf) {
  if (doc && doc.assemblies !== null && doc.assemblies !== undefined) {
    return assembliesModel(doc.assemblies);
  }
  return sourcePdf ? readAssemblies(sourcePdf) : null;
}

/** Write (or remove, when empty) the catalog key. */
export function saveAssemblies(pdf, model) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = assembliesModel(model);
  if (isEmptyAssemblies(valid)) { catalog.delete(PDFName.of(ASSEMBLIES_KEY)); return; }
  const json = JSON.stringify(valid);
  if (json.length > ASSEMBLY_JSON_MAX) throw new Error('Assemblies are too large to save.');
  catalog.set(PDFName.of(ASSEMBLIES_KEY), PDFHexString.fromText(json));
}
