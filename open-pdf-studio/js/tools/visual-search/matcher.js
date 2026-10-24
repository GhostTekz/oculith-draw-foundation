// Visual Search matcher (the external editor Visual Search): find every copy of a picked
// symbol on a page raster with normalised cross-correlation (NCC).
//
// Images are "ink" rasters: Float32Array, row-major, 0 = white paper,
// 1 = black ink. The page is rendered grey at a reduced scale (page-raster.js)
// so a symbol is some 30 px across; the template is the picked rectangle cut
// from the same raster. Variants: the template rotated 0/90/180/270° and,
// optionally, scaled by ±10 %.
//
// Two passes (searchImage):
//   1. coarse: every second window of a blurred page against blurred
//      variants. The window mean and variance come from integral images (a
//      window with far less contrast than the template is skipped at once)
//      and the correlation sum runs over the template's ink pixels only
//      (cov = Σ t·I − Σt·ΣI / n, so its zero pixels drop out). Peaks are
//      kept per variant;
//   2. refine: around each peak, dense NCC on a lightly softened page at
//      integer offsets and then quarter-pixel phases. That score is the
//      similarity; a greedy non-maximum suppression keeps the best of
//      overlapping hits.
// A match reports the symbol's ink box (the picked symbol's ink, turned and
// scaled like the variant), so counts sit on the symbol even for a loose pick.
//
// Pure functions without DOM or worker globals: the Web Worker
// (visual-search-worker.js), the in-place fallback (search-engine.js) and
// the node tests all use them.

/** Default similarity (NCC) a result needs to be listed as a match. */
export const DEFAULT_THRESHOLD = 0.92;
/** Lowest similarity the search keeps, so the slider can go down without a new search. */
export const SCORE_FLOOR = 0.5;
/** Most results one page returns (best first). */
export const MAX_RESULTS_PER_PAGE = 1500;
/** Template pixels with less ink than this do not enter the correlation sum. */
const INK_EPS = 0.02;
/** A window needs at least this share of the template's variance to be scored. */
const MIN_VARIANCE_RATIO = 0.2;
/** The [1 2 1] / 4 softening of the scoring pass (see searchImage). */
const SOFTEN = [0.25, 0.5, 0.25];
/** The coarse (blurred) pass keeps hits down to this much below the floor. */
const COARSE_MARGIN = 0.1;

/**
 * RGBA (white background assumed under transparent pixels) → ink raster.
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Float32Array}
 */
export function rgbaToInk(rgba, width, height) {
  const n = width * height;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    const lum = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
    // Composite over white: transparent = paper.
    out[i] = (1 - lum) * a;
  }
  return out;
}

/**
 * Cut a rectangle (raster pixels, clamped to the image) out of an ink image.
 * @returns {{ width:number, height:number, data:Float32Array, x:number, y:number }}
 */
export function cropInk(image, x, y, w, h) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(image.width, Math.round(x + w));
  const y1 = Math.min(image.height, Math.round(y + h));
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    data.set(image.data.subarray((y0 + r) * image.width + x0, (y0 + r) * image.width + x0 + width), r * width);
  }
  return { width, height, data, x: x0, y: y0 };
}

/**
 * Rotate an image clockwise by `quarter` × 90° (the page coordinate system
 * has y down, so clockwise on screen).
 */
export function rotateQuarter(img, quarter) {
  const q = ((quarter % 4) + 4) % 4;
  if (q === 0) return { width: img.width, height: img.height, data: Float32Array.from(img.data) };
  const { width: w, height: h, data } = img;
  const W = q % 2 ? h : w;
  const H = q % 2 ? w : h;
  const out = new Float32Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (q === 1) { nx = h - 1 - y; ny = x; } else if (q === 2) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = y; ny = w - 1 - x; }
      out[ny * W + nx] = data[y * w + x];
    }
  }
  return { width: W, height: H, data: out };
}

/** Bilinear resample by `factor` (≥ 1 px per side). */
export function resample(img, factor) {
  if (factor === 1) return { width: img.width, height: img.height, data: Float32Array.from(img.data) };
  const W = Math.max(1, Math.round(img.width * factor));
  const H = Math.max(1, Math.round(img.height * factor));
  const out = new Float32Array(W * H);
  const sx = img.width / W;
  const sy = img.height / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), tx = fx - x0;
      const a = img.data[y0 * img.width + x0], b = img.data[y0 * img.width + x1];
      const c = img.data[y1 * img.width + x0], d = img.data[y1 * img.width + x1];
      out[y * W + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return { width: W, height: H, data: out };
}

/**
 * Bounding box of the ink in an image (pixels with at least a quarter of the
 * darkest ink), as { x0, y0, x1, y1 } in continuous pixel coordinates; the
 * whole image when it has no ink.
 */
export function inkBox(img) {
  let max = 0;
  for (let i = 0; i < img.data.length; i++) max = Math.max(max, img.data[i]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (max > 0) {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (img.data[y * img.width + x] < max / 4) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
      }
    }
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: img.width, y1: img.height };
}

/** A box in a w×h image after `quarter` clockwise turns and scaling by f (as rotateQuarter/resample). */
export function transformBox(box, w, h, quarter, f = 1) {
  const q = ((quarter % 4) + 4) % 4;
  const corners = [[box.x0, box.y0], [box.x1, box.y1]].map(([x, y]) => {
    const [sx, sy] = [x * f, y * f];
    const [W, H] = [w * f, h * f];
    if (q === 1) return [H - sy, sx];
    if (q === 2) return [W - sx, H - sy];
    if (q === 3) return [sy, W - sx];
    return [sx, sy];
  });
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * The template variants to search for.
 * @param {{width:number,height:number,data:Float32Array}} template
 * @param {{ rotations?: boolean, scaleStep?: boolean }} [opts]
 * @returns {Array<{ rotation:number, scale:number, width:number, height:number, data:Float32Array,
 *   n:number, sumT:number, varT:number, idx:Int32Array, ws:Float32Array }>}
 *   idx: (row, column) of each ink pixel packed as row * width + column.
 */
export function buildVariants(template, { rotations = true, scaleStep = false } = {}) {
  const scales = scaleStep ? [1, 0.9, 1.1] : [1];
  const quarters = rotations ? [0, 1, 2, 3] : [0];
  const out = [];
  const box = inkBox(template);
  for (const scale of scales) {
    const scaled = resample(template, scale);
    const f = scaled.width / template.width;
    for (const q of quarters) {
      const v = rotateQuarter(scaled, q);
      const n = v.width * v.height;
      let sumT = 0, sumT2 = 0, ink = 0;
      for (let i = 0; i < n; i++) {
        sumT += v.data[i];
        sumT2 += v.data[i] * v.data[i];
        if (v.data[i] > INK_EPS) ink++;
      }
      const varT = sumT2 - (sumT * sumT) / n;
      if (!(varT > 1e-6)) continue; // a blank pick has nothing to match
      const idx = new Int32Array(ink);
      const ws = new Float32Array(ink);
      let k = 0;
      for (let i = 0; i < n; i++) {
        if (v.data[i] > INK_EPS) { idx[k] = i; ws[k] = v.data[i]; k++; }
      }
      out.push({ rotation: q * 90, scale, width: v.width, height: v.height, data: v.data, n, sumT, varT, idx, ws,
        box: transformBox(box, template.width, template.height, q, f) });
    }
  }
  return out;
}

/** Integral images of the ink and of its square: (w+1)×(h+1), Float64. */
export function integralImages(image) {
  const { width: w, height: h, data } = image;
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  const sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      rs += v;
      rq += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rq;
    }
  }
  return { sum, sq, W };
}

/**
 * Separable blur, by default [1 4 6 4 1] / 16 (σ ≈ 1 px); outside the image
 * is paper.
 * The coarse pass runs on blurred images so a symbol drawn half a pixel
 * off the sampling grid, or a stride-2 scan, still scores close to its peak.
 */
export function blur(img, K = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]) {
  const { width: w, height: h, data } = img;
  const R = (K.length - 1) / 2;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -R; k <= R; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) acc += K[k + R] * data[row + xx];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -R; k <= R; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) acc += K[k + R] * tmp[yy * w + x];
      }
      out[y * w + x] = acc;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Greedy non-maximum suppression: best first, a hit whose centre lies within
 * half a symbol of a kept one is the same symbol (another variant or a near
 * offset). Hits: { cx, cy, width, height, score, ... }.
 */
export function suppress(hits, maxResults = MAX_RESULTS_PER_PAGE) {
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const cell = Math.max(4, ...sorted.slice(0, 1).map((h) => Math.max(h.width, h.height)));
  const grid = new Map();
  const kept = [];
  for (const h of sorted) {
    const gx = Math.floor(h.cx / cell), gy = Math.floor(h.cy / cell);
    let clash = false;
    for (let dy = -1; dy <= 1 && !clash; dy++) {
      for (let dx = -1; dx <= 1 && !clash; dx++) {
        for (const m of grid.get(`${gx + dx},${gy + dy}`) || []) {
          const r = 0.5 * Math.max(Math.min(h.width, h.height), Math.min(m.width, m.height));
          if (Math.abs(m.cx - h.cx) < r && Math.abs(m.cy - h.cy) < r) { clash = true; break; }
        }
      }
    }
    if (clash) continue;
    kept.push(h);
    const key = `${gx},${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(h);
    if (kept.length >= maxResults) break;
  }
  return kept;
}

/**
 * Coarse pass: search `image` for `variants` (buildVariants) at every
 * `stride`-th window. Each variant keeps its own peaks (non-maximum
 * suppression per variant): on a blurred raster a half-turned copy may
 * outscore the right one a few pixels off, and the refinement then needs the
 * right variant's own peak. Returns hits in raster pixels: { x, y } top-left
 * of the window, width, height, cx, cy (centre), score, variant (index).
 * @param {{width:number,height:number,data:Float32Array}} image
 * @param {ReturnType<typeof buildVariants>} variants
 * @param {{ floor?: number, stride?: number, maxResults?: number }} [opts]
 */
export function matchVariants(image, variants, { floor = SCORE_FLOOR, stride = 1, maxResults = MAX_RESULTS_PER_PAGE * 2 } = {}) {
  const iw = image.width, ih = image.height;
  if (!variants.length || !(iw > 0) || !(ih > 0)) return [];
  const integ = integralImages(image);
  const { sum, sq, W } = integ;
  const data = image.data;
  const step = Math.max(1, stride | 0);
  const all = [];
  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const tw = v.width, th = v.height;
    if (tw > iw || th > ih) continue;
    const n = v.n, sumT = v.sumT, varT = v.varT;
    const minVar = varT * MIN_VARIANCE_RATIO;
    const k = v.idx.length;
    // Ink pixel offsets in the page raster for this image width.
    const offs = new Int32Array(k);
    for (let j = 0; j < k; j++) {
      const t = v.idx[j];
      const row = (t / tw) | 0;
      offs[j] = row * iw + (t - row * tw);
    }
    const ws = v.ws;
    const hx = tw >> 1, hy = th >> 1;
    const hits = [];
    for (let y = 0; y + th <= ih; y += step) {
      const ra = y * W, rc = (y + th) * W;
      for (let x = 0; x + tw <= iw; x += step) {
        const a = ra + x, b = a + tw, c = rc + x, d = c + tw;
        const S = sum[d] - sum[b] - sum[c] + sum[a];
        const S2 = sq[d] - sq[b] - sq[c] + sq[a];
        const varI = S2 - (S * S) / n;
        if (varI < minVar) continue;
        const base = y * iw + x;
        let acc = 0;
        for (let j = 0; j < k; j++) acc += ws[j] * data[base + offs[j]];
        const score = (acc - (sumT * S) / n) / Math.sqrt(varI * varT);
        if (score < floor) continue;
        hits.push({ x, y, width: tw, height: th, cx: x + hx, cy: y + hy, score, variant: vi });
      }
    }
    for (const h of suppress(hits, maxResults)) all.push(h);
  }
  return all;
}

/** Template `t` shifted by a sub-pixel (px, py) (bilinear; paper outside). */
export function shiftTemplate(t, px, py) {
  const { width: w, height: h, data } = t;
  const out = new Float32Array(w * h);
  const g = (xx, yy) => (xx >= 0 && yy >= 0 && xx < w && yy < h ? data[yy * w + xx] : 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x - px, fy = y - py;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      out[y * w + x] = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty)
        + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
  return { width: w, height: h, data: out };
}

/** Sub-pixel phases (px) tried around the best integer offset. */
const PHASES = [-0.5, -0.25, 0, 0.25, 0.5];

/** Dense NCC of template `t` at window top-left (x, y) (paper outside the image). */
function denseScore(image, t, x, y) {
  const { width: tw, height: th, data: td } = t;
  const iw = image.width, ih = image.height, id = image.data;
  const n = tw * th;
  let st = 0, st2 = 0, si = 0, si2 = 0, sti = 0;
  for (let r = 0; r < th; r++) {
    const yy = y + r;
    const inRow = yy >= 0 && yy < ih;
    for (let c = 0; c < tw; c++) {
      const a = td[r * tw + c];
      const xx = x + c;
      const b = inRow && xx >= 0 && xx < iw ? id[yy * iw + xx] : 0;
      st += a; st2 += a * a; si += b; si2 += b * b; sti += a * b;
    }
  }
  const vt = st2 - (st * st) / n, vi = si2 - (si * si) / n;
  if (!(vt > 1e-9) || !(vi > 1e-9)) return -1;
  return (sti - (st * si) / n) / Math.sqrt(vt * vi);
}

/** Best integer offset of variant `v` within ±reach of (x, y): { x, y, score }. */
function bestOffset(image, v, x, y, reach) {
  let best = { x, y, score: -1 };
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const s = denseScore(image, v, x + dx, y + dy);
      if (s > best.score) best = { x: x + dx, y: y + dy, score: s };
    }
  }
  return best;
}

/** Quarter-pixel phases (bilinear shifts of the template) around an integer offset. */
function bestPhase(image, v, at) {
  v.phases ??= new Map();
  let best = { ...at };
  for (const py of PHASES) {
    for (const px of PHASES) {
      if (!px && !py) continue;
      const key = `${px},${py}`;
      let t = v.phases.get(key);
      if (!t) { t = shiftTemplate(v, px, py); v.phases.set(key, t); }
      const s = denseScore(image, t, at.x, at.y);
      // The shifted template's content sits px to the right of its window.
      if (s > best.score) best = { x: at.x + px, y: at.y + py, score: s };
    }
  }
  return best;
}

/**
 * Refinement on the scoring raster around a coarse hit centred at (cx, cy):
 * the given variants at integer offsets within ±reach, then quarter-pixel
 * phases for the two best. Returns the window
 * { x, y, width, height } (x, y fractional), score, rotation and scale.
 */
export function refineHit(image, variants, cx, cy, reach = 2) {
  const tried = variants.map((v) => ({
    v, ...bestOffset(image, v, Math.round(cx - v.width / 2), Math.round(cy - v.height / 2), reach),
  })).sort((a, b) => b.score - a.score);
  let best = null;
  for (const c of tried.slice(0, 2)) {
    const r = bestPhase(image, c.v, c);
    if (!best || r.score > best.score) best = { ...r, v: c.v };
  }
  if (!best) return null;
  const { v } = best;
  return { x: best.x, y: best.y, width: v.width, height: v.height, cx: best.x + v.width / 2, cy: best.y + v.height / 2,
    score: Math.min(1, best.score), rotation: v.rotation, scale: v.scale, box: v.box };
}

/**
 * One page: ink image + template → matches, best first, in raster pixels:
 * { x, y, width, height } is the ink box of the found symbol (fractional),
 * window the matched picked-rectangle window, plus score (NCC, ≤ 1),
 * rotation (0/90/180/270, clockwise) and scale.
 * Coarse pass on blurred images (stride 2), then refineHit on lightly
 * softened ones.
 * @param {{width:number,height:number,data:Float32Array}} image
 * @param {{width:number,height:number,data:Float32Array}} template
 * @param {{ rotations?:boolean, scaleStep?:boolean, floor?:number, maxResults?:number, thumbs?:boolean }} [opts]
 */
export function searchImage(image, template, opts = {}) {
  const floor = opts.floor ?? SCORE_FLOOR;
  const maxResults = opts.maxResults ?? MAX_RESULTS_PER_PAGE;
  // Scoring runs on a lightly softened copy: a stroke about one pixel wide
  // then correlates the same at any sub-pixel position, so the score of a
  // true copy no longer depends on where it fell on the sampling grid.
  const sharpImage = blur(image, SOFTEN);
  const sharp = buildVariants(blur(template, SOFTEN), opts);
  const coarse = buildVariants(blur(template), opts);
  if (sharp.length !== coarse.length) return [];
  const hits = matchVariants(blur(image), coarse, { floor: Math.max(0, floor - COARSE_MARGIN), stride: 2 });
  const refined = [];
  for (const h of hits) {
    const r = refineHit(sharpImage, [sharp[h.variant]], h.cx, h.cy);
    if (r && r.score >= floor) refined.push(r);
  }
  // The window is the picked rectangle; a match reports the symbol's ink box
  // inside it, so a loose or off-centre pick still centres counts on the symbol.
  const matches = suppress(refined, maxResults).map((m) => ({
    x: m.x + m.box.x0, y: m.y + m.box.y0, width: m.box.x1 - m.box.x0, height: m.box.y1 - m.box.y0,
    window: { x: m.x, y: m.y, width: m.width, height: m.height },
    score: m.score, rotation: m.rotation, scale: m.scale,
  }));
  if (opts.thumbs !== false) {
    for (const m of matches) m.thumb = thumbnail(image, m.window.x, m.window.y, m.window.width, m.window.height);
  }
  return matches;
}

/**
 * A small grey thumbnail (≤ maxSide px, white paper) of a raster window, as
 * 8-bit luminance.
 * @returns {{ width:number, height:number, data:Uint8ClampedArray }}
 */
export function thumbnail(image, x, y, w, h, maxSide = 40) {
  const crop = cropInk(image, x, y, w, h);
  const f = Math.min(1, maxSide / Math.max(1, crop.width, crop.height));
  const small = f < 1 ? resample(crop, f) : crop;
  const data = new Uint8ClampedArray(small.width * small.height);
  for (let i = 0; i < data.length; i++) data[i] = 255 - Math.round(Math.min(1, small.data[i]) * 255);
  return { width: small.width, height: small.height, data };
}
