// A custom line style in the PDF: the saver writes the style the markup
// draws with into /OPS_LineStyle (UTF-16 JSON) next to its vector appearance,
// so the file reopens with the same style even on a machine that does not
// have it; the loader reads it back here. An imported .PAT hatch pattern
// travels the same way in /OPS_HatchDef (hatch-meta.js writes it).

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { cleanLineStyle, resolveLineStyle, LINE_STYLE_TYPES, lineStyleWidth } from '../../annotations/line-styles.js';
import { userLineStyles } from '../../annotations/custom-style-prefs.js';
import { registerDocumentHatchPattern } from '../../annotations/hatch-registry.js';
import { attachVectorAP } from './vector-ap.js';
import { buildLineStyleAP, rectUnion } from './line-style-ap.js';

/** The style a markup is saved with, or null. */
export function lijnstijlVoorOpslag(ann) {
  return ann?.lineStyleId ? resolveLineStyle(ann, userLineStyles()) : null;
}

/** Write /OPS_LineStyle (the clean definition, without the built-in flag). */
export function schrijfLijnstijlMeta(annotDict, style) {
  const clean = cleanLineStyle(style);
  if (!clean) return false;
  annotDict.set(PDFName.of('OPS_LineStyle'), pdfTextString(JSON.stringify(clean)));
  return true;
}

/**
 * Give a styled markup its line-style appearance: the layout along `points`
 * (app space), any `extraContent` (measurement labels) on top, the /Rect
 * grown to hold offsets and text, and /OPS_LineStyle. Returns false when the
 * markup has no style, so the caller writes its plain appearance.
 */
export function schrijfLijnstijlAppearance(context, annotDict, ann, points, { X, Y, pageRot = 0, strokeColorHex,
  rect, extra = null }) {
  const style = lijnstijlVoorOpslag(ann);
  if (!style) return false;
  const ap = buildLineStyleAP({ style, points, lineWidth: lineStyleWidth(ann),
    draaiing: (Number(pageRot) || 0) * Math.PI / 180, X, Y, strokeColorHex });
  const extraBuilt = extra ? extra() : null;
  const nieuweRect = rectUnion(rect, ap.bounds);
  annotDict.set(PDFName.of('Rect'), context.obj(nieuweRect));
  attachVectorAP(context, annotDict, {
    content: ap.content + (extraBuilt?.content || ''),
    needsFont: ap.needsFont || !!extraBuilt?.needsFont,
  }, nieuweRect);
  schrijfLijnstijlMeta(annotDict, style);
  return true;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Loader side: the style id and the embedded definition onto the model; an
 * embedded .PAT pattern into the hatch registry (the user's own pattern with
 * the same id wins).
 */
export function metLijnstijlUitBestand(model, extra) {
  if (!model || !extra) return model;
  if (typeof extra.opsHatchDef === 'string') {
    const def = parseJson(extra.opsHatchDef);
    if (def) registerDocumentHatchPattern(def);
  }
  if (typeof extra.opsLineStyle === 'string' && LINE_STYLE_TYPES.has(model.type)) {
    const def = cleanLineStyle(parseJson(extra.opsLineStyle));
    if (def) {
      model.lineStyleId = def.id;
      model.lineStyleDef = def;
    }
  }
  return model;
}
