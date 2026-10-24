// Exact .PAT line-family geometry, shared by the canvas (rendering/
// hatch-patterns.js) and the saved appearance (pdf/saver/appearance-vectors.js)
// so both draw the same dashes and dots. Pure.
//
// Line i of a family runs through the base point
//     P_i = anchor + origin + i * (deltaX * d + deltaY * n)
// with d the line direction and n its normal. The dash list starts at P_i and
// repeats along the line: positive = drawn, negative = space, 0 = a dot.

/** Dot radius of a .PAT dot at a hatch scale (page points). */
export function patDotRadius(scale) { return Math.max(0.4, 0.6 * scale); }

/**
 * @param {object} fam  a `pat: true` family (page points at scale 1)
 * @param {number} scale
 * @param {{cx:number, cy:number}} anchor  pattern phase anchor
 * @param {{left:number, top:number, right:number, bottom:number}} area  region to cover
 * @param {number} [max]  primitive budget; `truncated` is set when it ran out
 * @returns {{ segments: number[][], dots: number[][], truncated: boolean }}
 */
export function patFamilyPrimitives(fam, scale, anchor, area, max = 150000) {
  const out = { segments: [], dots: [], truncated: false };
  const a = (fam.angle * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;
  const spacing = fam.deltaY * scale;
  if (!(spacing > 0.01)) return out;
  const stagger = (fam.deltaX || 0) * scale;
  const ax = anchor.cx + (fam.originX || 0) * scale;
  const ay = anchor.cy + (fam.originY || 0) * scale;
  const corners = [[area.left, area.top], [area.right, area.top], [area.left, area.bottom], [area.right, area.bottom]];

  let pMin = Infinity, pMax = -Infinity;
  for (const [x, y] of corners) {
    const p = (x - ax) * nx + (y - ay) * ny;
    pMin = Math.min(pMin, p); pMax = Math.max(pMax, p);
  }
  if (!Number.isFinite(pMin)) return out;
  const dash = Array.isArray(fam.dashPattern) && fam.dashPattern.length ? fam.dashPattern.map(v => v * scale) : null;
  const period = dash ? dash.reduce((s, v) => s + Math.abs(v), 0) : 0;
  let budget = max;

  for (let i = Math.floor(pMin / spacing) - 1; i <= Math.ceil(pMax / spacing) + 1; i++) {
    const bx = ax + i * (stagger * dx + spacing * nx);
    const by = ay + i * (stagger * dy + spacing * ny);
    let tMin = Infinity, tMax = -Infinity;
    for (const [x, y] of corners) {
      const t = (x - bx) * dx + (y - by) * dy;
      tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    }
    const pt = (t) => [bx + t * dx, by + t * dy];
    if (!dash || !(period > 0)) {
      if (budget-- <= 0) { out.truncated = true; return out; }
      out.segments.push([...pt(tMin), ...pt(tMax)]);
      continue;
    }
    for (let k = Math.floor(tMin / period); k * period <= tMax; k++) {
      let s = k * period;
      for (const v of dash) {
        if (v > 0) {
          const lo = Math.max(s, tMin), hi = Math.min(s + v, tMax);
          if (hi > lo) {
            if (budget-- <= 0) { out.truncated = true; return out; }
            out.segments.push([...pt(lo), ...pt(hi)]);
          }
        } else if (v === 0 && s >= tMin && s <= tMax) {
          if (budget-- <= 0) { out.truncated = true; return out; }
          out.dots.push(pt(s));
        }
        s += Math.abs(v);
      }
    }
  }
  return out;
}
