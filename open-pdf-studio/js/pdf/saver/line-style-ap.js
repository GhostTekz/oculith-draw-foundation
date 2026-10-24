// Saved appearance of a custom line style: the layout of
// annotations/line-styles.js as PDF operators, so other viewers show the
// same pieces, dots, symbols and text as the canvas. Text uses the standard
// Helvetica appearance font (/Helv, WinAnsi) like the other vector
// appearances. Pure: points are app space, converted with X()/Y().

import { hexToRgb } from './utils.js';
import { winAnsiLiteral } from './pdf-text.js';
import { layoutLineStyle, lineStyleLayoutBounds } from '../../annotations/line-styles.js';

const f = (n) => {
  if (!isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const KAPPA = 0.5522847498;

/** PDF operators for a layout. `X`/`Y` map app space to PDF space. */
export function lineStyleOps(layout, X, Y, strokeColorHex) {
  const [r, g, b] = hexToRgb(strokeColorHex || '#000000');
  let s = `q\n${f(r)} ${f(g)} ${f(b)} RG\n${f(r)} ${f(g)} ${f(b)} rg\n0 J 0 j 10 M\n[] 0 d\n`;
  const pt = (p) => `${f(X(p.x))} ${f(Y(p.y))}`;
  let width = null;
  const setWidth = (w) => { if (w !== width) { s += `${f(w)} w\n`; width = w; } };
  for (const st of layout.strokes) {
    setWidth(st.width);
    s += `${pt(st.points[0])} m`;
    for (let i = 1; i < st.points.length; i++) s += ` ${pt(st.points[i])} l`;
    s += ' S\n';
  }
  for (const d of layout.dots) {
    const x = X(d.x), y = Y(d.y), rr = d.r, k = KAPPA * rr;
    s += `${f(x + rr)} ${f(y)} m ${f(x + rr)} ${f(y + k)} ${f(x + k)} ${f(y + rr)} ${f(x)} ${f(y + rr)} c `
      + `${f(x - k)} ${f(y + rr)} ${f(x - rr)} ${f(y + k)} ${f(x - rr)} ${f(y)} c `
      + `${f(x - rr)} ${f(y - k)} ${f(x - k)} ${f(y - rr)} ${f(x)} ${f(y - rr)} c `
      + `${f(x + k)} ${f(y - rr)} ${f(x + rr)} ${f(y - k)} ${f(x + rr)} ${f(y)} c f\n`;
  }
  for (const sh of layout.shapes) {
    setWidth(sh.width);
    s += `${pt(sh.points[0])} m`;
    for (let i = 1; i < sh.points.length; i++) s += ` ${pt(sh.points[i])} l`;
    s += sh.closed ? ' h' : '';
    s += sh.fill ? ' B\n' : ' S\n';
  }
  for (const t of layout.texts) {
    // App space is y down, PDF y up: the baseline (cos a, sin a) becomes
    // (cos a, -sin a) and the glyph up-vector (sin a, -cos a) becomes (sin a, cos a).
    const c = Math.cos(t.angle), sn = Math.sin(t.angle);
    s += `BT\n/Helv ${f(t.size)} Tf\n${f(c)} ${f(-sn)} ${f(sn)} ${f(c)} ${f(X(t.baseX))} ${f(Y(t.baseY))} Tm\n`;
    s += `(${winAnsiLiteral(t.text, { newlines: 'space' })}) Tj\nET\n`;
  }
  return `${s}Q\n`;
}

/**
 * Lay out and build the appearance for a styled markup.
 * @returns {{ content: string, needsFont: boolean, bounds: number[]|null }}  bounds: PDF [x1 y1 x2 y2]
 */
export function buildLineStyleAP({ style, points, lineWidth, draaiing = 0, X, Y, strokeColorHex }) {
  const layout = layoutLineStyle(style, points, { lineWidth, draaiing });
  const box = lineStyleLayoutBounds(layout);
  const bounds = box ? [
    Math.min(X(box.x1), X(box.x2)), Math.min(Y(box.y1), Y(box.y2)),
    Math.max(X(box.x1), X(box.x2)), Math.max(Y(box.y1), Y(box.y2)),
  ] : null;
  return { content: lineStyleOps(layout, X, Y, strokeColorHex), needsFont: layout.texts.length > 0, bounds, layout };
}

/** The union of two PDF rects. */
export function rectUnion(a, b) {
  if (!b) return a;
  if (!a) return b;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
