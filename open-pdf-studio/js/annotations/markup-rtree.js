// R-tree of markup boxes for snap and hit-testing. One tree per queried page,
// rebuilt when that page's geometry or membership changes. Items are
// wrappers so the annotation objects themselves stay free of minX/minY.

import { $RAW } from 'solid-js/store';
import RBush from '../vendor/rbush.js';
import { annotationBounds } from './spatial-index.js';
import { bandWidthIn, normalizeRaceway, drawPxPerIn } from './raceway.js';
import { maatTekstMarge } from './maat-label.js';

const cache = new WeakMap();

// doc.annotations is a Solid store: each property read through its proxy is
// a trap. The token reads every coordinate of every markup on each query
// (each pointer move during hover and snap), so it reads the raw objects the
// proxies write to. $RAW, not unwrap(): unwrap walks a plain array and
// replaces its elements. Callers still get the proxies back (zetIn).
const raw = (value) => (value && value[$RAW]) || value;

const NUM_KEYS = [
  'x', 'y', 'width', 'height', 'rotation', 'lineWidth',
  'startX', 'startY', 'endX', 'endY',
  'leaderStartX', 'leaderStartY', 'leaderEndX', 'leaderEndY',
  'centerX', 'centerY', 'radius',
  'textOffsetX', 'textOffsetY',
  'arrowX', 'arrowY', 'kneeX', 'kneeY',
  'measurePxPerIn', 'symbolSize',
  'fontSize', 'arcRadius', 'headSize',
];

// Hit radius on a callout tip is 1.5 screen tolerances. The query already
// pads by one tolerance, so the stored box keeps the other half. At the
// smallest zoom (5 %) that half is 100 page points.
const CALLOUT_SLACK = 100;
const CLOUD_PAD = 12;
const MEASURE_SLACK = 10;

function mixA(h, v) {
  h = (h ^ (v >>> 0)) >>> 0;
  h = Math.imul(h, 0x01000193) >>> 0;
  return h;
}

function mixB(h, v) {
  h = Math.imul((h ^ (v >>> 0)) >>> 0, 0x7feb352d) >>> 0;
  h = Math.imul((h ^ (h >>> 15)) >>> 0, 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function mixInt(state, n) {
  const v = Number.isFinite(n) ? n : 0;
  state.a = mixA(state.a, v);
  state.b = mixB(state.b, v);
}

function mixStr(state, s) {
  const str = String(s ?? '');
  state.a = mixA(state.a, str.length);
  state.b = mixB(state.b, str.length);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    state.a = mixA(state.a, c);
    state.b = mixB(state.b, c);
  }
}

// Coordinates round to 0.01 page point. Both mixes see the same words, but
// the mixers differ, so one 32-bit collision cannot hide a move.
function mixQuant(state, n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    state.a = mixA(state.a, 0x7fffffff);
    state.b = mixB(state.b, 0x7fffffff);
    return;
  }
  let q = Math.round(n * 100);
  const neg = q < 0 ? 1 : 0;
  if (neg) q = -q;
  const lo = q % 4294967296;
  const hi = Math.floor(q / 4294967296);
  state.a = mixA(state.a, lo);
  state.a = mixA(state.a, hi);
  state.a = mixA(state.a, neg);
  state.b = mixB(state.b, lo);
  state.b = mixB(state.b, hi);
  state.b = mixB(state.b, neg);
}

function mixPoints(state, pts) {
  if (!Array.isArray(pts)) return;
  mixInt(state, pts.length + 1);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    mixQuant(state, p?.x);
    mixQuant(state, p?.y);
  }
}

function geometryToken(annotations, page) {
  const state = { a: 0x811c9dc5, b: 0x9e3779b9 };
  mixInt(state, annotations.length);
  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    if (!ann || typeof ann !== 'object' || ann.page !== page) continue;
    // Slot changes, page reassignment and reorder must rebuild the queried
    // page. Other pages' potentially long point arrays are not read here.
    mixInt(state, i + 1);
    mixStr(state, ann.type || '');
    for (let k = 0; k < NUM_KEYS.length; k++) {
      const key = NUM_KEYS[k];
      const v = ann[key];
      if (typeof v !== 'number') continue;
      // The key's slot in NUM_KEYS identifies it as well as its name did,
      // without hashing the name character by character.
      mixInt(state, 0x100 + k);
      mixQuant(state, v);
    }
    mixPoints(state, ann.points);
    mixPoints(state, ann.path);
    if (Array.isArray(ann.holes)) {
      mixInt(state, ann.holes.length + 1);
      for (let h = 0; h < ann.holes.length; h++) mixPoints(state, ann.holes[h]);
    }
    mixPoints(state, ann.controlPoints);
    if (Array.isArray(ann.quadPoints)) {
      mixInt(state, ann.quadPoints.length + 1);
      for (let q = 0; q < ann.quadPoints.length; q++) mixPoints(state, ann.quadPoints[q]);
    }
    if (Array.isArray(ann.leaders)) {
      mixInt(state, ann.leaders.length + 1);
      for (let L = 0; L < ann.leaders.length; L++) {
        const leader = ann.leaders[L];
        mixQuant(state, leader?.kneeX);
        mixQuant(state, leader?.kneeY);
        mixQuant(state, leader?.tipX);
        mixQuant(state, leader?.tipY);
      }
    }
    if (Array.isArray(ann.rects)) {
      mixInt(state, ann.rects.length + 1);
      for (let r = 0; r < ann.rects.length; r++) {
        const rect = ann.rects[r];
        mixQuant(state, rect?.x);
        mixQuant(state, rect?.y);
        mixQuant(state, rect?.width);
        mixQuant(state, rect?.height);
      }
    }
    if (ann.raceway && typeof ann.raceway === 'object') {
      mixStr(state, 'rw');
      mixStr(state, ann.raceway.kind || '');
      mixStr(state, ann.raceway.tradeSize || '');
      mixStr(state, ann.raceway.conduitType || '');
      if (typeof ann.raceway.widthIn === 'number') mixQuant(state, ann.raceway.widthIn);
      mixInt(state, ann.raceway.trueSize ? 1 : 2);
    }
    if (ann.measureKind) mixStr(state, ann.measureKind);
    if (ann.markerStyle) mixStr(state, ann.markerStyle);
    if (ann.lineStyleId) mixStr(state, ann.lineStyleId);
    // The candidate box grows with the drawn label, the point-text glyphs,
    // and the angle arc. A change to only those must rebuild the tree.
    if (typeof ann.measureText === 'string') mixStr(state, ann.measureText);
    if (typeof ann.text === 'string') mixStr(state, ann.text);
    if (ann.textAlign) mixStr(state, ann.textAlign);
    if (ann.startHead) mixStr(state, ann.startHead);
    if (ann.endHead) mixStr(state, ann.endHead);
    if (ann.dimTextPosition) mixStr(state, ann.dimTextPosition);
  }
  return state;
}

function unionPoint(box, px, py, slack) {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return box;
  const s = slack || 0;
  const minX = Math.min(box.x, px - s);
  const minY = Math.min(box.y, py - s);
  const maxX = Math.max(box.x + box.width, px + s);
  const maxY = Math.max(box.y + box.height, py + s);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function countRadius(ann) {
  if (ann.markerStyle !== 'symbol') return 11;
  const s = Number(ann.symbolSize);
  if (Number.isFinite(s) && s >= 4 && s <= 480) return Math.max(11, s / 2 + 1);
  return 11;
}

// Cheap box, grown so a click on the drawn body still intersects the query.
function expandedBox(ann, b) {
  if (!b) return null;
  let box = { x: b.x, y: b.y, width: b.width, height: b.height };
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;

  if (ann.measureKind === 'raceway') {
    const rw = normalizeRaceway(ann.raceway);
    const px = drawPxPerIn(rw, ann.measurePxPerIn);
    const half = px ? bandWidthIn(rw) * px / 2 : 0;
    if (half > 0) {
      box = {
        x: box.x - half,
        y: box.y - half,
        width: box.width + half * 2,
        height: box.height + half * 2,
      };
    }
  }

  if (ann.type === 'cloud' || ann.type === 'cloudPolyline') {
    box = {
      x: box.x - CLOUD_PAD,
      y: box.y - CLOUD_PAD,
      width: box.width + CLOUD_PAD * 2,
      height: box.height + CLOUD_PAD * 2,
    };
  }

  if (ann.type === 'measureDistance') {
    if (ann.leaderStartX !== undefined) {
      box = unionPoint(box, ann.leaderStartX, ann.leaderStartY, MEASURE_SLACK);
      box = unionPoint(box, ann.leaderEndX, ann.leaderEndY, MEASURE_SLACK);
    }
    // The number sits off the line, on the readable side. A click on that
    // plate is a click on the measurement, including when the label was dragged.
    // Inline text sits on the line, which the centreline box already covers.
    if (ann.measureText
        && ann.dimTextPosition !== 'inline'
        && [ann.startX, ann.startY, ann.endX, ann.endY].every(Number.isFinite)) {
      const fs = Number(ann.fontSize) > 0 ? Number(ann.fontSize) : 11;
      const marge = maatTekstMarge({
        fontSize: fs,
        startHead: ann.startHead,
        endHead: ann.endHead,
        headSize: ann.headSize,
      });
      const half = Math.max(1, String(ann.measureText).length) * fs * 0.6 / 2;
      box = unionPoint(
        box,
        (ann.startX + ann.endX) / 2 + (Number(ann.textOffsetX) || 0),
        (ann.startY + ann.endY) / 2 + (Number(ann.textOffsetY) || 0),
        half + marge + fs,
      );
    }
  }

  // Point text is drawn upward from the baseline, and a long line is wider
  // than the 24 pt stand-in box.
  if (ann.type === 'text' && Number.isFinite(ann.x) && Number.isFinite(ann.y)) {
    const fs = Number(ann.fontSize) > 0 ? Number(ann.fontSize) : 16;
    const lines = String(ann.text || '').split('\n');
    let longest = 1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > longest) longest = lines[i].length;
    }
    const width = Math.max(longest * fs, 1);
    let left = ann.x;
    if (ann.textAlign === 'center') left -= width / 2;
    else if (ann.textAlign === 'right' || ann.textAlign === 'end') left -= width;
    const top = ann.y - fs;
    const bottom = ann.y + Math.max(0, lines.length - 1) * fs * 1.3;
    box = unionPoint(box, left, top, 0);
    box = unionPoint(box, left + width, Math.max(ann.y, bottom), 0);
  }

  // The arc can sit well outside the triangle of the three points.
  if (ann.type === 'measureAngle' && Number.isFinite(ann.vertex?.x) && Number.isFinite(ann.vertex?.y)) {
    const r = Number(ann.arcRadius) > 0 ? Number(ann.arcRadius) : 30;
    box = unionPoint(box, ann.vertex.x, ann.vertex.y, r);
  }

  if ((ann.type === 'viewport' || ann.type === 'scaleRegion')
      && Number.isFinite(ann.x) && Number.isFinite(ann.y)) {
    box = unionPoint(box, ann.x, ann.y - 16, 0);
    box = unionPoint(box, ann.x + 160, ann.y, 0);
  }

  // The count dot is centred on (x, y). The cheap box starts at that corner.
  if (ann.type === 'count' && Number.isFinite(ann.x) && Number.isFinite(ann.y)) {
    box = unionPoint(box, ann.x, ann.y, countRadius(ann));
  }

  if (ann.type === 'callout') {
    const coH = ann.height || 50;
    const ax = ann.arrowX !== undefined ? ann.arrowX : ann.x - 60;
    const ay = ann.arrowY !== undefined ? ann.arrowY : ann.y + coH;
    const kx = ann.kneeX !== undefined ? ann.kneeX : ann.x - 30;
    const ky = ann.kneeY !== undefined ? ann.kneeY : ann.y + coH / 2;
    box = unionPoint(box, ax, ay, CALLOUT_SLACK);
    box = unionPoint(box, kx, ky, CALLOUT_SLACK);
  }

  if (Array.isArray(ann.rects)) {
    for (let i = 0; i < ann.rects.length; i++) {
      const rect = ann.rects[i];
      if (!rect) continue;
      box = unionPoint(box, rect.x, rect.y, 0);
      box = unionPoint(box, (rect.x || 0) + (rect.width || 0), (rect.y || 0) + (rect.height || 0), 0);
    }
  }

  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;
  return box;
}

function buildPage(annotations, page) {
  const items = [];
  const always = [];
  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    if (!ann || ann.page !== page) continue;
    // Store the slot, not the object. Undo replaces the objects and keeps
    // the geometry, and a cached object would then miss every click.
    let box = null;
    try {
      box = expandedBox(ann, annotationBounds(ann, { goedkoop: true }));
    } catch {
      box = null;
    }
    if (!box) {
      always.push(i);
      continue;
    }
    items.push({
      minX: box.x,
      minY: box.y,
      maxX: box.x + box.width,
      maxY: box.y + box.height,
      i,
    });
  }
  const tree = new RBush();
  if (items.length) tree.load(items);
  return { tree, always };
}

function indexFor(annotations, page) {
  const source = raw(annotations);
  const token = geometryToken(source, page);
  let pages = cache.get(annotations);
  if (!pages) {
    pages = new Map();
    cache.set(annotations, pages);
  }
  const prev = pages.get(page);
  if (prev?.a === token.a && prev?.b === token.b) {
    pages.delete(page);
    pages.set(page, prev);
    return prev.index;
  }
  const index = buildPage(source, page);
  pages.delete(page);
  pages.set(page, { a: token.a, b: token.b, index });
  // Continuous view can touch thousands of pages. Keep only recent trees.
  while (pages.size > 32) pages.delete(pages.keys().next().value);
  return index;
}

/**
 * Candidate slots in paint order (topmost first). `null` means the index
 * failed: callers must fall back to scanning the page.
 */
export function markupsNearIndices(annotations, page, x, y, pad) {
  if (!Array.isArray(annotations) || annotations.length === 0) return [];
  try {
    const found = indexFor(annotations, page);
    const r = Number.isFinite(pad) ? pad : 0;
    const hits = found.tree.search({
      minX: x - r,
      minY: y - r,
      maxX: x + r,
      maxY: y + r,
    });
    const slots = new Set(found.always);
    for (let i = 0; i < hits.length; i++) slots.add(hits[i].i);
    return [...slots].sort((a, b) => b - a);
  } catch {
    return null;
  }
}

/** Annotations on `page` whose box can produce a snap or hit at (x, y). */
export function markupsNear(annotations, page, x, y, pad) {
  const slots = markupsNearIndices(annotations, page, x, y, pad);
  if (slots === null) return null;
  const out = new Set();
  for (const slot of slots) {
    const ann = annotations[slot];
    if (ann) out.add(ann);
  }
  return out;
}
