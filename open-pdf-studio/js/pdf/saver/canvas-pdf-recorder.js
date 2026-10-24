// Canvas-to-PDF path recorder: a stand-in 2D context that records what a
// canvas draw function does and replays it as PDF content-stream operators.
// A symbol's own `draw(ctx, ...)` code then produces both the screen pixels
// (real canvas) and a true vector appearance (/AP /N) with no image XObject.
//
// Supported subset (what symbol draw functions use): beginPath, moveTo,
// lineTo, bezierCurveTo, quadraticCurveTo, arc, ellipse, rect, roundRect
// (one radius), closePath, fill (nonzero/evenodd), stroke, clip, fillRect,
// strokeRect, fillText/strokeText/measureText (standard Helvetica /
// Helvetica-Bold), save/restore, translate/rotate/scale/transform/
// setTransform/resetTransform/getTransform, lineWidth, lineCap, lineJoin,
// miterLimit, setLineDash/lineDashOffset, fillStyle/strokeStyle as CSS
// colours (hex, rgb(a), a few names), globalAlpha, font, textAlign and
// textBaseline. Everything else (images, gradients, patterns, pixel access,
// clearRect, arcTo, shadows, filters, composite modes) throws an
// UnsupportedCanvasOperation, so a caller can fall back on purpose instead of
// writing a wrong appearance.
//
// Coordinates: the draw function works in "app space" (page points, y down,
// as the annotation canvas). toPdf({ X, Y }) maps app space to PDF space with
// the same X()/Y() functions as the other vector appearances.

import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';
import { toWinAnsiText, winAnsiLiteral } from './pdf-text.js';

export class UnsupportedCanvasOperation extends Error {
  constructor(operation) {
    super(`Canvas-to-PDF recorder: "${operation}" is not supported`);
    this.name = 'UnsupportedCanvasOperation';
    this.operation = operation;
  }
}

const f = (n) => {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};

const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [ // m · n (apply n first, then m), canvas/PDF row convention
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
const isIdentity = (m) => m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12);

const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], yellow: [255, 255, 0],
  orange: [255, 165, 0],
};

/** A CSS colour as { rgb: [0..1]x3, a: 0..1 }. Throws for gradients, patterns and unknown names. */
export function parseCanvasColor(value) {
  if (typeof value !== 'string') throw new UnsupportedCanvasOperation('non-colour fill/stroke style (gradient or pattern)');
  const s = value.trim().toLowerCase();
  if (s === 'transparent' || s === 'none') return { rgb: [0, 0, 0], a: 0 };
  if (NAMED[s]) return { rgb: NAMED[s].map(v => v / 255), a: 1 };
  let m = /^#([0-9a-f]{3,4})$/u.exec(s);
  if (m) {
    const d = [...m[1]].map(c => parseInt(c + c, 16));
    return { rgb: d.slice(0, 3).map(v => v / 255), a: d.length === 4 ? d[3] / 255 : 1 };
  }
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/u.exec(s);
  if (m) {
    const d = m[1].match(/../gu).map(h => parseInt(h, 16));
    return { rgb: d.slice(0, 3).map(v => v / 255), a: d.length === 4 ? d[3] / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/u.exec(s);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { rgb: [m[1], m[2], m[3]].map(v => Math.min(255, Math.max(0, parseFloat(v))) / 255),
      a: Math.min(1, Math.max(0, a)) };
  }
  throw new UnsupportedCanvasOperation(`colour "${value}"`);
}

const FONTS = {
  Helv: { base: 'Helvetica', embedder: null, std: StandardFonts.Helvetica },
  HeBo: { base: 'Helvetica-Bold', embedder: null, std: StandardFonts.HelveticaBold },
};
function textWidth(key, text, size) {
  const font = FONTS[key];
  font.embedder ??= StandardFontEmbedder.for(font.std);
  try { return font.embedder.widthOfTextAtSize(toWinAnsiText(text, { newlines: 'space' }), size); } catch { return 0.556 * size * String(text).length; }
}
// Font box of Helvetica (em units), used for textBaseline and bounds.
const ASCENT = 0.718;
const EM_TOP = 0.905;
const EM_BOTTOM = 0.212;

function parseFont(font) {
  const s = String(font || '');
  const size = /([\d.]+)px/u.exec(s);
  const bold = /\b(bold|bolder|[6-9]00)\b/u.test(s);
  return { size: size ? parseFloat(size[1]) : 10, key: bold ? 'HeBo' : 'Helv' };
}

const UNSUPPORTED_METHODS = ['drawImage', 'createLinearGradient', 'createRadialGradient', 'createConicGradient',
  'createPattern', 'getImageData', 'putImageData', 'createImageData', 'clearRect', 'arcTo',
  'isPointInPath', 'isPointInStroke', 'drawFocusIfNeeded', 'scrollPathIntoView', 'reset'];
const PASSIVE_PROPS = new Set(['imageSmoothingEnabled', 'imageSmoothingQuality', 'direction', 'fontKerning',
  'textRendering', 'letterSpacing', 'wordSpacing', 'fontStretch', 'fontVariantCaps']);

/**
 * A new recorder. `ctx` is the fake 2D context to hand to a draw function;
 * `toPdf({ X, Y })` returns the PDF operators and resources.
 */
export function createCanvasPdfRecorder() {
  const ops = [];                 // content in root (app) space
  const extGStates = new Map();   // "ca/CA" key -> name
  const usedFonts = new Set();
  let bbox = null;                // root space [x1, y1, x2, y2]
  let st = {
    ctm: IDENTITY, fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt',
    lineJoin: 'miter', miterLimit: 10, dash: [], dashOffset: 0, globalAlpha: 1, font: '10px sans-serif',
    textAlign: 'start', textBaseline: 'alphabetic', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    shadowColor: 'rgba(0, 0, 0, 0)', globalCompositeOperation: 'source-over', filter: 'none',
  };
  const stack = [];
  let path = [];                  // [{ op: 'm'|'l'|'c'|'h', p: [x,y,...] }] in root space
  let current = null;             // [x, y] root space
  let subStart = null;

  const grow = (x, y, pad = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!bbox) bbox = [x - pad, y - pad, x + pad, y + pad];
    else {
      bbox[0] = Math.min(bbox[0], x - pad); bbox[1] = Math.min(bbox[1], y - pad);
      bbox[2] = Math.max(bbox[2], x + pad); bbox[3] = Math.max(bbox[3], y + pad);
    }
  };
  const finite = (...v) => v.every(Number.isFinite);
  const tp = (x, y) => apply(st.ctm, x, y);

  function moveToRoot(p) { path.push({ op: 'm', p }); current = p; subStart = p; }
  function lineToRoot(p) {
    if (!current) { moveToRoot(p); return; }
    path.push({ op: 'l', p }); current = p;
  }

  // Arc of the ellipse centre (cx, cy), radii rx/ry, rotated by `rot`, from
  // angle a0 over `sweep` (radians, signed), as cubic Béziers (<= 90° each).
  function ellipseArc(cx, cy, rx, ry, rot, a0, sweep) {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const pt = (ux, uy) => tp(cx + rx * ux * cr - ry * uy * sr, cy + rx * ux * sr + ry * uy * cr);
    const start = pt(Math.cos(a0), Math.sin(a0));
    if (current) lineToRoot(start); else moveToRoot(start);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / n;
    const k = (4 / 3) * Math.tan(step / 4);
    let t0 = a0;
    for (let i = 0; i < n; i++) {
      const t1 = t0 + step;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const p1 = pt(c0 - k * s0, s0 + k * c0);
      const p2 = pt(c1 + k * s1, s1 - k * c1);
      const p3 = pt(c1, s1);
      path.push({ op: 'c', p: [...p1, ...p2, ...p3] });
      current = p3;
      t0 = t1;
    }
  }
  function arcSweep(start, end, ccw) {
    const tau = Math.PI * 2;
    if (!ccw && end - start >= tau) return tau;
    if (ccw && start - end >= tau) return -tau;
    if (!ccw) { let d = (end - start) % tau; if (d < 0) d += tau; return d; }
    let d = (start - end) % tau; if (d < 0) d += tau; return -d;
  }

  function alphaGs(fillA, strokeA) {
    const ca = Math.round(fillA * 1000) / 1000, CA = Math.round(strokeA * 1000) / 1000;
    if (ca >= 1 && CA >= 1) return '';
    const key = `${ca}/${CA}`;
    if (!extGStates.has(key)) extGStates.set(key, `GSr${extGStates.size}`);
    return `/${extGStates.get(key)} gs\n`;
  }
  function checkPaintState() {
    if (st.globalCompositeOperation !== 'source-over') throw new UnsupportedCanvasOperation(`globalCompositeOperation ${st.globalCompositeOperation}`);
    if (st.filter && st.filter !== 'none') throw new UnsupportedCanvasOperation('filter');
    const shadow = parseCanvasColor(st.shadowColor);
    if (shadow.a > 0 && (st.shadowBlur || st.shadowOffsetX || st.shadowOffsetY)) throw new UnsupportedCanvasOperation('shadow');
  }
  const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  function strokeStateOps(color) {
    const cap = { butt: 0, round: 1, square: 2 }[st.lineCap] ?? 0;
    const join = { miter: 0, round: 1, bevel: 2 }[st.lineJoin] ?? 0;
    return `${f(color.rgb[0])} ${f(color.rgb[1])} ${f(color.rgb[2])} RG\n${f(st.lineWidth)} w ${cap} J ${join} j ${f(st.miterLimit)} M\n`
      + `[${st.dash.map(f).join(' ')}] ${f(st.dashOffset)} d\n`;
  }
  // Path in the user space of `m` (inverse-mapped root points).
  function pathOps(m) {
    const inv = m ? invert(m) : null;
    const map = (x, y) => (inv ? apply(inv, x, y) : [x, y]);
    let s = '';
    for (const seg of path) {
      if (seg.op === 'h') { s += 'h\n'; continue; }
      const out = [];
      for (let i = 0; i < seg.p.length; i += 2) out.push(...map(seg.p[i], seg.p[i + 1]));
      s += `${out.map(f).join(' ')} ${seg.op}\n`;
    }
    return s;
  }
  function pathBounds(pad) {
    for (const seg of path) for (let i = 0; i < seg.p.length; i += 2) grow(seg.p[i], seg.p[i + 1], pad);
  }
  function paint(kind, rule) {
    checkPaintState();
    if (!path.some(seg => seg.op !== 'm' && seg.op !== 'h')) return;
    const color = parseCanvasColor(kind === 'fill' ? st.fillStyle : st.strokeStyle);
    const alpha = color.a * st.globalAlpha;
    if (alpha <= 0) return;
    if (kind === 'fill') {
      ops.push(`q\n${alphaGs(alpha, 1)}${f(color.rgb[0])} ${f(color.rgb[1])} ${f(color.rgb[2])} rg\n${pathOps(null)}${rule === 'evenodd' ? 'f*' : 'f'}\nQ\n`);
      pathBounds(0);
      return;
    }
    const m = st.ctm;
    if (!invert(m)) return;
    const cm = isIdentity(m) ? '' : `${m.map(f).join(' ')} cm\n`;
    ops.push(`q\n${alphaGs(1, alpha)}${strokeStateOps(color)}${cm}${pathOps(isIdentity(m) ? null : m)}S\nQ\n`);
    const half = (st.lineWidth * scaleOf(m)) / 2;
    pathBounds(st.lineJoin === 'miter' ? half * Math.min(st.miterLimit, 4) : half);
  }
  function text(kind, txt, x, y) {
    checkPaintState();
    const content = String(txt ?? '');
    if (!content || !finite(x, y)) return;
    const color = parseCanvasColor(kind === 'fill' ? st.fillStyle : st.strokeStyle);
    const alpha = color.a * st.globalAlpha;
    if (alpha <= 0) return;
    const { size, key } = parseFont(st.font);
    if (!(size > 0)) return;
    usedFonts.add(key);
    const width = textWidth(key, content, size);
    const align = st.textAlign;
    let dx = 0;
    if (align === 'center') dx = -width / 2;
    else if (align === 'right' || align === 'end') dx = -width;
    const dy = { top: EM_TOP, hanging: ASCENT, middle: (EM_TOP - EM_BOTTOM) / 2, alphabetic: 0,
      ideographic: -EM_BOTTOM, bottom: -EM_BOTTOM }[st.textBaseline] ?? 0;
    const bx = x + dx, by = y + dy * size;
    const m = st.ctm;
    if (!invert(m)) return;
    const cm = isIdentity(m) ? '' : `${m.map(f).join(' ')} cm\n`;
    const paintOps = kind === 'fill'
      ? `${alphaGs(alpha, 1)}${f(color.rgb[0])} ${f(color.rgb[1])} ${f(color.rgb[2])} rg\n`
      : `${alphaGs(1, alpha)}${strokeStateOps(color)}1 Tr\n`;
    // y-down user space: flip the text matrix so glyphs stand upright.
    ops.push(`q\n${paintOps}${cm}BT\n/${key} ${f(size)} Tf\n1 0 0 -1 ${f(bx)} ${f(by)} Tm\n(${winAnsiLiteral(content, { newlines: 'space' })}) Tj\nET\nQ\n`);
    for (const [px, py] of [[bx, by - EM_TOP * size], [bx + width, by - EM_TOP * size], [bx, by + EM_BOTTOM * size], [bx + width, by + EM_BOTTOM * size]]) {
      grow(...apply(m, px, py));
    }
  }

  const ctx = {
    canvas: null,
    save() { stack.push({ ...st, dash: [...st.dash] }); ops.push('q\n'); },
    restore() { if (!stack.length) return; st = stack.pop(); ops.push('Q\n'); },
    translate(x, y) { if (finite(x, y)) st.ctm = mul(st.ctm, [1, 0, 0, 1, x, y]); },
    rotate(a) { if (finite(a)) { const c = Math.cos(a), s = Math.sin(a); st.ctm = mul(st.ctm, [c, s, -s, c, 0, 0]); } },
    scale(x, y) { if (finite(x, y)) st.ctm = mul(st.ctm, [x, 0, 0, y, 0, 0]); },
    transform(a, b, c, d, e, g) { if (finite(a, b, c, d, e, g)) st.ctm = mul(st.ctm, [a, b, c, d, e, g]); },
    setTransform(a, b, c, d, e, g) {
      if (a === undefined) { st.ctm = IDENTITY; return; }
      if (typeof a === 'object' && a) { st.ctm = [a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0]; return; }
      if (finite(a, b, c, d, e, g)) st.ctm = [a, b, c, d, e, g];
    },
    resetTransform() { st.ctm = IDENTITY; },
    getTransform() { const [a, b, c, d, e, g] = st.ctm; return { a, b, c, d, e, f: g, is2D: true }; },
    beginPath() { path = []; current = null; subStart = null; },
    moveTo(x, y) { if (finite(x, y)) moveToRoot(tp(x, y)); },
    lineTo(x, y) { if (finite(x, y)) lineToRoot(tp(x, y)); },
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      if (!finite(x1, y1, x2, y2, x, y)) return;
      if (!current) moveToRoot(tp(x1, y1));
      const p = [...tp(x1, y1), ...tp(x2, y2), ...tp(x, y)];
      path.push({ op: 'c', p }); current = p.slice(4);
    },
    quadraticCurveTo(cx, cy, x, y) {
      if (!finite(cx, cy, x, y)) return;
      if (!current) moveToRoot(tp(cx, cy));
      const [x0, y0] = current; const [qx, qy] = tp(cx, cy); const [x3, y3] = tp(x, y);
      path.push({ op: 'c', p: [x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0),
        x3 + (2 / 3) * (qx - x3), y3 + (2 / 3) * (qy - y3), x3, y3] });
      current = [x3, y3];
    },
    arc(cx, cy, r, start, end, ccw = false) {
      if (!finite(cx, cy, r, start, end)) return;
      if (r < 0) throw new RangeError('negative radius');
      ellipseArc(cx, cy, r, r, 0, start, arcSweep(start, end, !!ccw));
    },
    ellipse(cx, cy, rx, ry, rot, start, end, ccw = false) {
      if (!finite(cx, cy, rx, ry, rot, start, end)) return;
      if (rx < 0 || ry < 0) throw new RangeError('negative radius');
      ellipseArc(cx, cy, rx, ry, rot, start, arcSweep(start, end, !!ccw));
    },
    rect(x, y, w, h) {
      if (!finite(x, y, w, h)) return;
      moveToRoot(tp(x, y)); lineToRoot(tp(x + w, y)); lineToRoot(tp(x + w, y + h)); lineToRoot(tp(x, y + h));
      ctx.closePath();
    },
    roundRect(x, y, w, h, radii = 0) {
      const r = Array.isArray(radii) ? (radii.length === 1 ? radii[0] : NaN) : radii;
      if (typeof r !== 'number' || !Number.isFinite(r)) throw new UnsupportedCanvasOperation('roundRect with per-corner radii');
      if (!finite(x, y, w, h)) return;
      const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
      if (!rr) { ctx.rect(x, y, w, h); return; }
      const sx = Math.sign(w) || 1, sy = Math.sign(h) || 1;
      ctx.moveTo(x + sx * rr, y);
      ctx.lineTo(x + w - sx * rr, y);
      ctx.ellipse(x + w - sx * rr, y + sy * rr, rr, rr, 0, -Math.PI / 2, 0, false);
      ctx.lineTo(x + w, y + h - sy * rr);
      ctx.ellipse(x + w - sx * rr, y + h - sy * rr, rr, rr, 0, 0, Math.PI / 2, false);
      ctx.lineTo(x + sx * rr, y + h);
      ctx.ellipse(x + sx * rr, y + h - sy * rr, rr, rr, 0, Math.PI / 2, Math.PI, false);
      ctx.lineTo(x, y + sy * rr);
      ctx.ellipse(x + sx * rr, y + sy * rr, rr, rr, 0, Math.PI, Math.PI * 1.5, false);
      ctx.closePath();
    },
    closePath() {
      if (!current) return;
      path.push({ op: 'h', p: [] });
      current = subStart;
    },
    fill(rule) {
      if (typeof rule === 'object' && rule) throw new UnsupportedCanvasOperation('fill(Path2D)');
      paint('fill', rule);
    },
    stroke(arg) {
      if (arg !== undefined) throw new UnsupportedCanvasOperation('stroke(Path2D)');
      paint('stroke');
    },
    clip(rule) {
      if (typeof rule === 'object' && rule) throw new UnsupportedCanvasOperation('clip(Path2D)');
      if (!path.length) return;
      ops.push(`${pathOps(null)}${rule === 'evenodd' ? 'W*' : 'W'} n\n`);
    },
    fillRect(x, y, w, h) {
      const saved = { path, current, subStart };
      ctx.beginPath(); ctx.rect(x, y, w, h); paint('fill');
      ({ path, current, subStart } = saved);
    },
    strokeRect(x, y, w, h) {
      const saved = { path, current, subStart };
      ctx.beginPath(); ctx.rect(x, y, w, h); paint('stroke');
      ({ path, current, subStart } = saved);
    },
    fillText(t, x, y) { text('fill', t, x, y); },
    strokeText(t, x, y) { text('stroke', t, x, y); },
    measureText(t) {
      const { size, key } = parseFont(st.font);
      const width = textWidth(key, String(t ?? ''), size);
      return { width, actualBoundingBoxAscent: ASCENT * size, actualBoundingBoxDescent: EM_BOTTOM * size,
        fontBoundingBoxAscent: EM_TOP * size, fontBoundingBoxDescent: EM_BOTTOM * size,
        actualBoundingBoxLeft: 0, actualBoundingBoxRight: width };
    },
    setLineDash(list) {
      if (!Array.isArray(list) || list.some(v => !Number.isFinite(v) || v < 0)) return;
      st.dash = list.length % 2 ? [...list, ...list] : [...list];
    },
    getLineDash() { return [...st.dash]; },
  };
  for (const name of UNSUPPORTED_METHODS) ctx[name] = () => { throw new UnsupportedCanvasOperation(name); };

  const STATE_PROPS = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit',
    'globalAlpha', 'font', 'textAlign', 'textBaseline', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY',
    'shadowColor', 'globalCompositeOperation', 'filter']);
  const proxy = new Proxy(ctx, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key === 'lineDashOffset') return st.dashOffset;
      if (STATE_PROPS.has(key)) return st[key];
      if (key in target) return target[key];
      if (PASSIVE_PROPS.has(key)) return undefined;
      if (key === 'then' || key === 'toJSON') return undefined;
      throw new UnsupportedCanvasOperation(key);
    },
    set(target, key, value) {
      if (key === 'lineDashOffset') { if (Number.isFinite(value)) st.dashOffset = value; return true; }
      if (key === 'lineWidth' || key === 'miterLimit') { if (Number.isFinite(value) && value > 0) st[key] = value; return true; }
      if (key === 'globalAlpha') { if (Number.isFinite(value) && value >= 0 && value <= 1) st.globalAlpha = value; return true; }
      if (key === 'fillStyle' || key === 'strokeStyle') {
        if (typeof value !== 'string') throw new UnsupportedCanvasOperation(`${key} gradient/pattern`);
        parseCanvasColor(value);
        st[key] = value; return true;
      }
      if (STATE_PROPS.has(key)) { st[key] = value; return true; }
      if (PASSIVE_PROPS.has(key)) return true;
      throw new UnsupportedCanvasOperation(`set ${String(key)}`);
    },
  });

  return {
    ctx: proxy,
    /** Has anything been painted? */
    get empty() { return !bbox; },
    /**
     * PDF operators for the recording. App space maps to PDF space either by
     * `map(x, y) -> { x, y }` (any affine map, e.g. the saver's point mapper
     * for rotated and cropped pages) or by `X`/`Y` (x from x, y from y, as
     * the saver's convertX/convertY).
     * @returns {{ content: string, bounds: number[]|null, fonts: Record<string,string>,
     *   extGStates: Record<string,{ca:number, CA:number}>, needsFont: boolean }}
     */
    toPdf({ X, Y, map }) {
      let root;
      if (typeof map === 'function') {
        const o = map(0, 0), ux = map(1, 0), uy = map(0, 1);
        root = [ux.x - o.x, ux.y - o.y, uy.x - o.x, uy.y - o.y, o.x, o.y];
      } else {
        root = [X(1) - X(0), 0, 0, Y(1) - Y(0), X(0), Y(0)];
      }
      let depth = 0;
      for (const op of ops) { if (op === 'q\n') depth++; else if (op === 'Q\n') depth--; }
      const content = `q\n${root.map(f).join(' ')} cm\n${ops.join('')}${'Q\n'.repeat(Math.max(0, depth))}Q\n`;
      let bounds = null;
      if (bbox) {
        const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]]
          .map(([x, y]) => apply(root, x, y));
        const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
        bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
      const fonts = {};
      for (const key of usedFonts) fonts[key] = FONTS[key].base;
      const gs = {};
      for (const [key, name] of extGStates) { const [ca, CA] = key.split('/').map(Number); gs[name] = { ca, CA }; }
      return { content, bounds, fonts, extGStates: gs, needsFont: false };
    },
  };
}
