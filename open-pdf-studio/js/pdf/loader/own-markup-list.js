// A page's markup list read with pdf-lib, in the shape PDF.js
// `page.getAnnotations()` (display intent) gives it, for pages that hold
// only the editor's own simple markups: Squares and Circles it wrote (they
// carry OPS_* keys) and their Text replies (/IRT). On such a page the loader
// takes this list instead of asking PDF.js, which parses every annotation a
// second time in its worker and copies the result back to the page.
//
// The fields follow PDF.js 6 (src/core/annotation.js: Annotation,
// MarkupAnnotation, TextAnnotation, SquareAnnotation, CircleAnnotation,
// AnnotationBorderStyle; src/core/core_utils.js stringToPDFString). Anything
// on the page that this module does not reproduce exactly (another subtype,
// a CMYK colour, a Popup, rich text, an appearance it would have to build,
// an encrypted file, a string PDF.js would decode differently) makes it
// answer null, and the loader asks PDF.js as before.

import {
  PDFDict, PDFArray, PDFName, PDFNumber, PDFString, PDFHexString, PDFRef, PDFStream, PDFNull, PDFBool,
} from 'pdf-lib';

// PDF.js AnnotationType.
const SUBTYPES = { Text: 1, Square: 5, Circle: 6 };
// PDF.js AnnotationFlag.
const INVISIBLE = 1;
const NOROTATE = 16;
const NOVIEW = 32;
// PDF.js AnnotationBorderStyleType.
const BORDER_STYLES = { S: 1, D: 2, B: 3, I: 4, U: 5 };
// The default size of a Text annotation without an appearance (PDF.js).
const TEXT_ICON_SIZE = 22;

// Not reproduced: the caller falls back to PDF.js.
const FALLBACK = Symbol('fallback');
function fallback() { throw FALLBACK; }

// A plain name of the kind the editor writes, read the same by both parsers.
const PLAIN_NAME = /^[A-Za-z0-9_.-]+$/;
// Characters PDF.js's bidi() counts as right-to-left: their `dir` is not
// worked out here.
const RTL = /[֐-״؀-ࢬﭐ-﷿ﹰ-﻿]/;

// PDFName.of decodes the name on every call: the keys read here, once.
const names = new Map();
function key(name) {
  let n = names.get(name);
  if (!n) { n = PDFName.of(name); names.set(name, n); }
  return n;
}

export function refId(ref) {
  // PDF.js Ref.toString(): the id PDF.js gives the annotation.
  return ref.generationNumber === 0
    ? `${ref.objectNumber}R`
    : `${ref.objectNumber}R${ref.generationNumber}`;
}

function nameOf(obj) {
  if (!(obj instanceof PDFName)) return null;
  const name = obj.decodeText();
  if (!PLAIN_NAME.test(name)) fallback();
  return name;
}

// ─── Strings, as the PDF.js lexer and stringToPDFString read them ─────────

// Bytes of a literal string from its raw contents (PDF.js Lexer.getString).
function literalBytes(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    if (ch !== 0x5c) { out.push(raw[i]); continue; }
    i++;
    if (i >= raw.length) break;
    const e = raw.charCodeAt(i);
    switch (e) {
      case 0x6e: out.push('\n'); break;
      case 0x72: out.push('\r'); break;
      case 0x74: out.push('\t'); break;
      case 0x62: out.push('\b'); break;
      case 0x66: out.push('\f'); break;
      case 0x0d: if (raw.charCodeAt(i + 1) === 0x0a) i++; break;
      case 0x0a: break;
      default:
        if (e >= 0x30 && e <= 0x37) {
          let x = e & 0x0f;
          const c2 = raw.charCodeAt(i + 1);
          if (c2 >= 0x30 && c2 <= 0x37) {
            i++;
            x = (x << 3) + (c2 & 0x0f);
            const c3 = raw.charCodeAt(i + 1);
            if (c3 >= 0x30 && c3 <= 0x37) {
              i++;
              x = (x << 3) + (c3 & 0x0f);
            }
          }
          out.push(String.fromCharCode(x));
        } else {
          out.push(String.fromCharCode(e));
        }
    }
  }
  return out.join('');
}

// PDF.js Lexer.getHexString: white space and invalid digits skipped, an odd
// last digit padded with 0.
function hexBytes(raw) {
  const out = [];
  let first = -1;
  for (let i = 0; i < raw.length; i++) {
    const d = parseInt(raw[i], 16);
    if (Number.isNaN(d)) continue;
    if (first === -1) first = d;
    else { out.push(String.fromCharCode((first << 4) | d)); first = -1; }
  }
  if (first !== -1) out.push(String.fromCharCode(first << 4));
  return out.join('');
}

/** A string object as PDF.js holds it (one char per byte), else undefined. */
function rawString(obj) {
  if (obj instanceof PDFString) return literalBytes(obj.value);
  if (obj instanceof PDFHexString) return hexBytes(obj.value);
  return undefined;
}

const decoders = {};
function decodeWith(encoding, str) {
  let bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c > 0xff) fallback();
    bytes[i] = c;
  }
  if (encoding !== 'utf-8' && bytes.length % 2 === 1) bytes = bytes.subarray(0, -1);
  decoders[encoding] ??= new TextDecoder(encoding, { fatal: true });
  try {
    return decoders[encoding].decode(bytes);
  } catch {
    // PDF.js then reads the bytes as PDFDocEncoding.
    return fallback();
  }
}

// PDF.js stringToPDFString for the strings it decodes the same way here:
// a byte-order mark, or PDFDocEncoding bytes that map to themselves.
function pdfString(str) {
  let text;
  if (str[0] === '\xFE' && str[1] === '\xFF') text = decodeWith('utf-16be', str);
  else if (str[0] === '\xFF' && str[1] === '\xFE') text = decodeWith('utf-16le', str);
  else if (str[0] === '\xEF' && str[1] === '\xBB' && str[2] === '\xBF') text = decodeWith('utf-8', str);
  else {
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      // Escape sequences and the PDFDocEncoding bytes PDF.js translates.
      if (c === 0x1b || (c >= 0x18 && c <= 0x1f) || (c >= 0x80 && c <= 0x9e) || c === 0xa0) fallback();
    }
    text = str;
  }
  if (text.includes('\x1b')) fallback();
  return text;
}

// PDF.js Annotation._parseStringHelper.
function textObj(obj) {
  const raw = rawString(obj);
  const str = raw === undefined ? '' : pdfString(raw);
  if (RTL.test(str)) fallback();
  return { str, dir: 'ltr' };
}

// ─── Values as PDF.js Dict.get / Dict.getArray give them ──────────────────

function make(ctx) {
  const lookup = (v) => {
    if (v instanceof PDFRef) {
      const o = ctx.lookup(v);
      if (o === undefined || o === PDFNull) fallback();
      return o;
    }
    return v;
  };
  const get = (dict, k) => lookup(dict.get(key(k)));
  const has = (dict, k) => dict.get(key(k)) !== undefined;
  // A number array element (getArray resolves one level of references), a
  // nested reference stays an object (NaN in PDF.js arithmetic).
  const element = (v) => {
    const o = lookup(v);
    if (o instanceof PDFNumber) return o.asNumber();
    if (o instanceof PDFArray) return o.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : NaN));
    if (o instanceof PDFName || o instanceof PDFString || o instanceof PDFHexString || o instanceof PDFBool) fallback();
    return NaN;
  };
  const getArray = (dict, k) => {
    const o = get(dict, k);
    if (o === undefined) return undefined;
    if (!(o instanceof PDFArray)) return o instanceof PDFNumber ? o.asNumber() : o;
    return o.asArray().map(element);
  };
  return { lookup, get, has, getArray };
}

const isNumberArray = (a, n) => Array.isArray(a) && (n == null || a.length === n) && a.every((x) => typeof x === 'number');

// PDF.js getRgbColor for gray and RGB (CMYK goes through PDF.js's own
// conversion: not reproduced).
function rgbColor(color, defaultColor) {
  if (!Array.isArray(color)) return defaultColor;
  const out = defaultColor || new Uint8ClampedArray(3);
  switch (color.length) {
    case 0: return null;
    case 1: {
      if (typeof color[0] !== 'number') fallback();
      const c = color[0] * 255;
      out[0] = out[1] = out[2] = c;
      return out;
    }
    case 3:
      if (!isNumberArray(color)) fallback();
      out[0] = color[0] * 255;
      out[1] = color[1] * 255;
      out[2] = color[2] * 255;
      return out;
    case 4: return fallback();
    default: return defaultColor;
  }
}

// PDF.js AnnotationBorderStyle with setBorderStyle(dict).
function borderStyle(r, dict, rect) {
  const bs = { width: 1, rawWidth: 1, style: 1, dashArray: [3], horizontalCornerRadius: 0, verticalCornerRadius: 0 };
  const setWidth = (width, box = [0, 0, 0, 0]) => {
    if (width instanceof PDFName) { bs.width = 0; return; }
    if (typeof width === 'number') {
      if (width > 0) {
        bs.rawWidth = width;
        const maxWidth = (box[2] - box[0]) / 2;
        const maxHeight = (box[3] - box[1]) / 2;
        if (maxWidth > 0 && maxHeight > 0 && (width > maxWidth || width > maxHeight)) width = 1;
      }
      bs.width = width;
    }
  };
  const setStyle = (style) => {
    const name = nameOf(style);
    if (name && BORDER_STYLES[name]) bs.style = BORDER_STYLES[name];
  };
  const setDashArray = (dash, forceStyle = false) => {
    if (Array.isArray(dash)) {
      let valid = true;
      let allZeros = true;
      for (const el of dash) {
        if (!(+el >= 0)) { valid = false; break; }
        if (el > 0) allZeros = false;
      }
      if (dash.length === 0 || (valid && !allZeros)) {
        bs.dashArray = dash;
        if (forceStyle) bs.style = BORDER_STYLES.D;
      } else {
        bs.width = 0;
      }
    } else if (dash) {
      bs.width = 0;
    }
  };
  if (r.has(dict, 'BS')) {
    const d = r.get(dict, 'BS');
    if (d instanceof PDFDict) {
      const type = r.get(d, 'Type');
      if (!type || nameOf(type) === 'Border') {
        const w = r.get(d, 'W');
        setWidth(w instanceof PDFNumber ? w.asNumber() : w, rect);
        setStyle(r.get(d, 'S'));
        setDashArray(r.getArray(d, 'D'));
      }
    }
  } else if (r.has(dict, 'Border')) {
    const arr = r.getArray(dict, 'Border');
    if (Array.isArray(arr)) {
      if (arr.length >= 3) {
        if (Number.isInteger(arr[0])) bs.horizontalCornerRadius = arr[0];
        if (Number.isInteger(arr[1])) bs.verticalCornerRadius = arr[1];
        setWidth(arr[2], rect);
        if (arr.length === 4) setDashArray(arr[3], true);
      } else if (arr.length === 0) {
        setWidth(0);
      }
    }
  } else {
    setWidth(0);
  }
  return bs;
}

// PDF.js Annotation.setAppearance: is there a normal appearance stream?
function hasAppearance(r, dict) {
  const ap = r.get(dict, 'AP');
  if (!(ap instanceof PDFDict)) return false;
  const n = r.get(ap, 'N');
  if (n instanceof PDFStream) return true;
  if (!(n instanceof PDFDict)) return false;
  const as = r.get(dict, 'AS');
  if (!(as instanceof PDFName)) return false;
  return r.lookup(n.get(as)) instanceof PDFStream;
}

// PDF.js Annotation.#setOptionalContent with parseMarkedContentProps (an
// OCG only; a membership dictionary is not reproduced).
function optionalContent(r, dict) {
  if (!has(dict, 'OC')) return undefined;
  const raw = dict.get(key('OC'));
  const oc = r.lookup(raw);
  if (!(oc instanceof PDFDict)) return undefined; // PDF.js: a warning, no _oc
  const type = r.get(oc, 'Type');
  const typeName = type instanceof PDFName ? nameOf(type) : undefined;
  if (typeName === 'OCG') return { type: 'OCG', id: raw instanceof PDFRef ? refId(raw) : null };
  if (typeName === 'OCMD') fallback();
  return null;
}
const has = (dict, k) => dict.get(key(k)) !== undefined;

const dateOf = (obj) => {
  const s = rawString(obj);
  return typeof s === 'string' ? s : null;
};

function ownKeys(dict) {
  for (const [k] of dict.entries()) if (k.asString().startsWith('/OPS_')) return true;
  return false;
}

// One annotation dictionary → its PDF.js data, or null when the display
// intent leaves it out.
function annotationData(r, ref, dict, structTree) {
  for (const [, v] of dict.entries()) if (v === PDFNull) fallback();
  const subtype = nameOf(r.get(dict, 'Subtype'));
  if (!SUBTYPES[subtype]) fallback();
  if (subtype === 'Text' ? !(dict.get(key('IRT')) instanceof PDFRef) : !ownKeys(dict)) fallback();
  if (has(dict, 'RC') || has(dict, 'Parent')) fallback();

  const title = textObj(r.get(dict, 'T'));
  const contents = textObj(r.get(dict, 'Contents'));
  const modificationDate = dateOf(r.get(dict, 'M'));
  const f = r.get(dict, 'F');
  const fv = f instanceof PDFNumber ? f.asNumber() : null;
  let flags = Number.isInteger(fv) && fv > 0 ? fv : 0;
  if (flags & INVISIBLE) flags ^= INVISIBLE;
  const rectArr = r.getArray(dict, 'Rect');
  const rect = isNumberArray(rectArr, 4)
    ? [Math.min(rectArr[0], rectArr[2]), Math.min(rectArr[1], rectArr[3]), Math.max(rectArr[0], rectArr[2]), Math.max(rectArr[1], rectArr[3])]
    : [0, 0, 0, 0];
  let color = rgbColor(r.getArray(dict, 'C'), new Uint8ClampedArray(3));
  const bs = borderStyle(r, dict, rect);
  const appearance = hasAppearance(r, dict);
  // Square and Circle without an appearance get one built by PDF.js, which
  // also changes their rect.
  if (subtype !== 'Text' && !appearance) fallback();
  const oc = optionalContent(r, dict);
  const mk = r.get(dict, 'MK');
  let borderColor = null;
  let backgroundColor = null;
  let rotation = 0;
  if (mk instanceof PDFDict) {
    borderColor = rgbColor(r.getArray(mk, 'BC'), null);
    backgroundColor = rgbColor(r.getArray(mk, 'BG'), null);
  }
  const angleObj = mk instanceof PDFDict ? r.get(mk, 'R') : r.get(dict, 'Rotate');
  let angle = angleObj instanceof PDFNumber ? angleObj.asNumber() : 0;
  if (Number.isInteger(angle) && angle !== 0) {
    angle %= 360;
    if (angle < 0) angle += 360;
    if (angle % 90 === 0) rotation = angle;
  }
  const noRotate = !!(flags & NOROTATE);
  const data = {
    annotationType: SUBTYPES[subtype],
    annotationFlags: flags,
    borderStyle: bs,
    color,
    backgroundColor,
    borderColor,
    rotation,
    contentsObj: contents,
    hasAppearance: appearance,
    id: refId(ref),
    modificationDate,
    oc,
    rect,
    subtype,
    hasOwnCanvas: false,
    noRotate,
    // Locked and LockedContents (PDF.js); Square and Text clear it below.
    noHTML: !!(flags & 128) && !!(flags & 512),
    isEditable: false,
    structParent: -1,
  };
  if (structTree) {
    const sp = r.get(dict, 'StructParent');
    const v = sp instanceof PDFNumber ? sp.asNumber() : null;
    data.structParent = Number.isInteger(v) && v >= 0 ? v : -1;
  }
  const it = r.get(dict, 'IT');
  if (it instanceof PDFName) data.it = nameOf(it);

  // MarkupAnnotation.
  let popupRaw;
  if (has(dict, 'IRT')) {
    const irt = dict.get(key('IRT'));
    data.inReplyTo = irt instanceof PDFRef ? refId(irt) : null;
    const rt = r.get(dict, 'RT');
    data.replyType = rt instanceof PDFName ? nameOf(rt) : 'R';
  }
  if (data.replyType === 'Group') {
    const parent = r.get(dict, 'IRT');
    if (!(parent instanceof PDFDict)) fallback();
    for (const [, v] of parent.entries()) if (v === PDFNull) fallback();
    data.titleObj = textObj(r.get(parent, 'T'));
    data.contentsObj = textObj(r.get(parent, 'Contents'));
    data.creationDate = has(parent, 'CreationDate') ? dateOf(r.get(parent, 'CreationDate')) : null;
    data.modificationDate = has(parent, 'M') ? dateOf(r.get(parent, 'M')) : null;
    popupRaw = parent.get(key('Popup'));
    data.color = has(parent, 'C') ? rgbColor(r.getArray(parent, 'C'), new Uint8ClampedArray(3)) : null;
  } else {
    data.titleObj = title;
    data.creationDate = dateOf(r.get(dict, 'CreationDate'));
    popupRaw = dict.get(key('Popup'));
    if (!has(dict, 'C')) data.color = null;
  }
  data.popupRef = popupRaw instanceof PDFRef ? refId(popupRaw) : null;

  if (subtype === 'Text') {
    data.noRotate = true;
    data.hasOwnCanvas = true;
    if (appearance) {
      data.name = 'NoIcon';
    } else {
      data.rect[1] = data.rect[3] - TEXT_ICON_SIZE;
      data.rect[2] = data.rect[0] + TEXT_ICON_SIZE;
      const name = r.get(dict, 'Name');
      if (name !== undefined && !(name instanceof PDFName)) fallback();
      data.name = name ? nameOf(name) : 'Note';
    }
    if (has(dict, 'State')) {
      const state = r.get(dict, 'State');
      const model = r.get(dict, 'StateModel');
      const s = rawString(state);
      const m = model === undefined ? undefined : rawString(model);
      if (s === undefined || (model !== undefined && m === undefined)) fallback();
      data.state = s || null;
      data.stateModel = m || null;
    } else {
      data.state = null;
      data.stateModel = null;
    }
    data.noHTML = false;
  } else if (subtype === 'Square') {
    data.hasOwnCanvas = data.noRotate;
    data.noHTML = false;
  }

  // The display intent (PDF.js getAnnotationsData): an annotation with
  // NoView is left out.
  const viewable = flags === 0 || !(flags & NOVIEW);
  return viewable ? data : null;
}

// /Annots of the page or of a parent (PDF.js #getInheritableProperty).
function inheritedAnnots(r, pageNode) {
  let node = pageNode;
  for (let depth = 0; node instanceof PDFDict && depth < 100; depth++) {
    if (has(node, 'Annots')) return r.get(node, 'Annots');
    node = r.get(node, 'Parent');
  }
  return undefined;
}

/**
 * The PDF.js display-intent annotation list of page `pageNum` (1-based) of
 * `pdfDoc` (pdf-lib), or null when the page holds anything this reader does
 * not reproduce exactly.
 * @returns {object[] | null}
 */
export function ownMarkupList(pdfDoc, pageNum) {
  try {
    if (pdfDoc.isEncrypted) return null;
    const ctx = pdfDoc.context;
    const r = make(ctx);
    const page = pdfDoc.getPages()[pageNum - 1];
    if (!page) return null;
    const annots = inheritedAnnots(r, page.node);
    if (!(annots instanceof PDFArray)) return annots === undefined ? [] : null;
    const catalog = ctx.lookup(ctx.trailerInfo.Root);
    const structTree = catalog instanceof PDFDict && r.get(catalog, 'StructTreeRoot') instanceof PDFDict;
    const seen = new Set();
    const out = [];
    for (const ref of annots.asArray()) {
      if (!(ref instanceof PDFRef)) return null;
      const id = refId(ref);
      if (seen.has(id)) return null;
      seen.add(id);
      const dict = ctx.lookup(ref);
      if (!(dict instanceof PDFDict) || dict instanceof PDFStream) return null;
      const data = annotationData(r, ref, dict, structTree);
      if (data) out.push(data);
    }
    return out;
  } catch (e) {
    if (e === FALLBACK) return null;
    throw e;
  }
}
