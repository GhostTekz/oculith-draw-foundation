// PDF persistence of Formula columns and Custom Captions (formula-captions.js).
//
//   Catalog /OPS_FormulaCaptionsV1   JSON { v, columns, captions } (document)
//   Annot   /OPS_CaptionTemplateV1   the markup's own caption template
//
// The PDF is untrusted input: both keys are bounded before decoding and
// validated after; malformed values read as absent.

import { PDFHexString, PDFName, PDFString } from 'pdf-lib';
import {
  formulaCaptionsModel, isEmptyFormulaCaptions, captionTemplate,
  FORMULA_CAPTIONS_JSON_MAX, CAPTION_TEMPLATE_MAX,
} from '../annotations/formula-captions.js';
import { decodePdfTextObject, pdfTextString } from './saver/pdf-text.js';

export const FORMULA_CAPTIONS_KEY = 'OPS_FormulaCaptionsV1';
export const CAPTION_TEMPLATE_KEY = 'OPS_CaptionTemplateV1';

/** The document model from the catalog, or null when absent or malformed. */
export function readFormulaCaptions(pdf) {
  try {
    const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
    const raw = catalog?.lookup(PDFName.of(FORMULA_CAPTIONS_KEY));
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)
        || raw.value.length > (FORMULA_CAPTIONS_JSON_MAX + 1) * 4) return null;
    const json = raw.decodeText();
    if (json.length > FORMULA_CAPTIONS_JSON_MAX) return null;
    const model = formulaCaptionsModel(JSON.parse(json));
    return isEmptyFormulaCaptions(model) ? null : model;
  } catch { return null; }
}

/**
 * The model to save: the document's (once read or edited) else what the
 * source PDF holds, so an early save before the async read keeps it.
 */
export function formulaCaptionsForSave(doc, sourcePdf) {
  if (doc && doc.formulaCaptions !== null && doc.formulaCaptions !== undefined) {
    return formulaCaptionsModel(doc.formulaCaptions);
  }
  return sourcePdf ? readFormulaCaptions(sourcePdf) : null;
}

/** Write (or remove, when empty) the catalog key. */
export function saveFormulaCaptions(pdf, model) {
  const catalog = pdf.context.lookup(pdf.context.trailerInfo.Root);
  if (!catalog) return;
  const valid = formulaCaptionsModel(model);
  if (isEmptyFormulaCaptions(valid)) { catalog.delete(PDFName.of(FORMULA_CAPTIONS_KEY)); return; }
  const json = JSON.stringify(valid);
  if (json.length > FORMULA_CAPTIONS_JSON_MAX) throw new Error('Formula columns and captions are too large to save.');
  catalog.set(PDFName.of(FORMULA_CAPTIONS_KEY), PDFHexString.fromText(json));
}

/** Write a markup's own caption template on its annotation dictionary. */
export function writeCaptionTemplate(annotDict, ann) {
  if (!annotDict || typeof annotDict.set !== 'function') return false;
  const template = captionTemplate(ann?.captionTemplate);
  if (!template) return false;
  annotDict.set(PDFName.of(CAPTION_TEMPLATE_KEY), pdfTextString(template));
  return true;
}

/** { captionTemplate } read from an annotation dictionary, or {}. */
export function readCaptionTemplate(annotDict, context) {
  if (!annotDict || typeof annotDict.get !== 'function') return {};
  try {
    const ref = annotDict.get(PDFName.of(CAPTION_TEMPLATE_KEY));
    const raw = ref ? (context.lookup(ref) || ref) : null;
    if (!(raw instanceof PDFHexString || raw instanceof PDFString)
        || raw.value.length > (CAPTION_TEMPLATE_MAX + 1) * 4) return {};
    const template = captionTemplate(decodePdfTextObject(raw));
    return template ? { captionTemplate: template } : {};
  } catch { return {}; }
}
