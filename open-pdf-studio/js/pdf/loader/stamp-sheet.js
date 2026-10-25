// A small PDF of a page's stamp appearances, one page per stamp, each page
// exactly the stamp's /Rect. The loader renders it with PDF.js instead of
// rendering the drawing under the stamps (image-extraction.js): a stamp's
// picture then costs its own appearance, not the whole sheet's content and
// every other markup on it, and nothing under the stamp is baked into it.
//
// Each page draws the appearance as PDF.js draws an annotation appearance
// (src/core/annotation.js getOperatorList / getTransformMatrix): the /BBox,
// taken through the form /Matrix, is fitted onto the /Rect. A stamp PDF.js
// would not draw on screen (Hidden, NoView, an optional-content group), or
// draws in a way of its own (NoRotate), is left out: it keeps the sheet
// render.

import { PDFDocument, PDFDict, PDFArray, PDFName, PDFNumber, PDFRef, PDFStream, PDFObjectCopier } from 'pdf-lib';
import { refId } from './own-markup-list.js';

const HIDDEN = 2;
const NOROTATE = 16;
const NOVIEW = 32;

const N = (name) => PDFName.of(name);
// A number as PDF content syntax (no exponent).
const num = (x) => {
  const s = (Math.abs(x) < 1e-9 ? 0 : x).toFixed(9).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
};

function numbers(ctx, obj, n) {
  const arr = ctx.lookup(obj);
  if (!(arr instanceof PDFArray) || arr.size() !== n) return null;
  const out = [];
  for (const v of arr.asArray()) {
    const x = ctx.lookup(v);
    if (!(x instanceof PDFNumber)) return null;
    out.push(x.asNumber());
  }
  return out;
}

// PDF.js Annotation.setAppearance.
function normalAppearance(ctx, dict) {
  const ap = ctx.lookup(dict.get(N('AP')));
  if (!(ap instanceof PDFDict)) return null;
  const n = ctx.lookup(ap.get(N('N')));
  if (n instanceof PDFStream) return n;
  if (!(n instanceof PDFDict)) return null;
  const as = ctx.lookup(dict.get(N('AS')));
  if (!(as instanceof PDFName)) return null;
  const s = ctx.lookup(n.get(as));
  return s instanceof PDFStream ? s : null;
}

// PDF.js getTransformMatrix: the /BBox through /Matrix, fitted on the rect.
export function appearanceTransform(rect, bbox, matrix) {
  const [a, b, c, d, e, f] = matrix;
  const xs = [];
  const ys = [];
  for (const [x, y] of [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]]) {
    xs.push(a * x + c * y + e);
    ys.push(b * x + d * y + f);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (minX === maxX || minY === maxY) return [1, 0, 0, 1, rect[0], rect[1]];
  const xRatio = (rect[2] - rect[0]) / (maxX - minX);
  const yRatio = (rect[3] - rect[1]) / (maxY - minY);
  return [xRatio, 0, 0, yRatio, rect[0] - minX * xRatio, rect[1] - minY * yRatio];
}

/**
 * The stamp appearances `ids` (PDF.js annotation ids) of page `pageNum`
 * (1-based) of `pdfDoc` (pdf-lib) as one PDF, page i+1 for stamps[i].
 * Stamps it cannot draw this way are not in `stamps`.
 * @returns {Promise<{ bytes: Uint8Array, stamps: string[] } | null>}
 */
export async function buildStampSheet(pdfDoc, pageNum, ids) {
  if (pdfDoc.isEncrypted || !ids?.length) return null;
  const ctx = pdfDoc.context;
  const page = pdfDoc.getPages()[pageNum - 1];
  if (!page) return null;
  const annots = ctx.lookup(page.node.get(N('Annots')));
  if (!(annots instanceof PDFArray)) return null;
  const wanted = new Set(ids);
  const userUnit = ctx.lookup(page.node.get(N('UserUnit')));

  const out = await PDFDocument.create({ updateMetadata: false });
  const copier = PDFObjectCopier.for(ctx, out.context);
  const stamps = [];
  for (const ref of annots.asArray()) {
    if (!(ref instanceof PDFRef)) continue;
    const id = refId(ref);
    if (!wanted.has(id)) continue;
    wanted.delete(id);
    const dict = ctx.lookup(ref);
    if (!(dict instanceof PDFDict)) continue;
    if (ctx.lookup(dict.get(N('Subtype')))?.toString() !== '/Stamp') continue;
    const f = ctx.lookup(dict.get(N('F')));
    const flags = f instanceof PDFNumber && Number.isInteger(f.asNumber()) && f.asNumber() > 0 ? f.asNumber() : 0;
    if (flags & (HIDDEN | NOVIEW | NOROTATE)) continue;
    if (dict.get(N('OC')) !== undefined) continue;
    const raw = numbers(ctx, dict.get(N('Rect')), 4);
    if (!raw) continue;
    const rect = [Math.min(raw[0], raw[2]), Math.min(raw[1], raw[3]), Math.max(raw[0], raw[2]), Math.max(raw[1], raw[3])];
    if (!(rect[2] > rect[0]) || !(rect[3] > rect[1])) continue;
    const appearance = normalAppearance(ctx, dict);
    if (!appearance) continue;
    const form = copier.copy(appearance);
    const bbox = numbers(out.context, form.dict.get(N('BBox')), 4) || [0, 0, rect[2] - rect[0], rect[3] - rect[1]];
    const matrix = numbers(out.context, form.dict.get(N('Matrix')), 6) || [1, 0, 0, 1, 0, 0];
    const t = appearanceTransform(rect, bbox, matrix);
    const formRef = out.context.register(form);
    const sheet = out.addPage([rect[2] - rect[0], rect[3] - rect[1]]);
    sheet.node.set(N('MediaBox'), out.context.obj(rect));
    if (userUnit instanceof PDFNumber) sheet.node.set(N('UserUnit'), userUnit);
    sheet.node.set(N('Resources'), out.context.obj({ XObject: { S0: formRef } }));
    sheet.node.set(N('Contents'), out.context.register(out.context.stream(`q ${t.map(num).join(' ')} cm /S0 Do Q`)));
    stamps.push(id);
  }
  if (!stamps.length) return null;
  return { bytes: await out.save({ useObjectStreams: false }), stamps };
}
