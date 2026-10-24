// plan-review measurement extras on the existing measure annotation types.
//
// The extra measure tools do not add new geometry types: they reuse the
// geometry, handles, hit testing, transforms and PDF form of the three base
// measurements and add a "kind" plus a few properties.
//
//   measurePerimeter + measureKind 'polylength'  Polylength (open polyline,
//                                                total and per-segment values)
//   measurePerimeter + measureKind 'arc'         Arc length (3-point arc,
//                                                points hold the densified arc)
//   measureArea      + measureKind 'volume'      Volume = area x depth
//   measureDistance  + measureKind 'radius'      3-point radius (centre -> rim)
//   measurePerimeter + measureKind 'raceway'     conduit / cable tray run; the
//                                                `raceway` object and the
//                                                geometry live in raceway.js
//
// Optional properties on any of the three base types:
//   measureDepth, measureDepthUnit    depth (Length/Polylength -> wall area,
//                                     Volume -> volume)
//   measureSlopeMode, measureSlope    'degree' | 'grade' (%) | 'pitch' (x:12);
//                                     the length/area is the sloped value
//   measureShowSegments               per-segment labels on a polyline
//   measureShowCentroid               centroid marker on an area
//   measureCaption                    which values the label shows
//
// Everything here is pure: the caller passes the resolved scale at the
// annotation (getMeasureScale) and the formatters from measurement.js. An
// uncalibrated scale keeps page units and the "Scale not set" warning.

import { nettoVlakOppervlak } from './vlak-ringen.js';
import {
  normalizeRaceway, racewayGeometry, racewayLabel, fittingsText, bendsText, NEC_MAX_BENDS,
  branchJunction, junctionKey, validRunId,
} from './raceway.js';
import { conduitFill, fillText } from './conduit-fill.js';

export const BASE_MEASURE_TYPES = Object.freeze(['measureDistance', 'measureArea', 'measurePerimeter']);

/** Kind -> the type id used in lists, CSV/PDF summaries and the panel. */
export const MEASURE_KIND_TYPES = Object.freeze({
  polylength: 'measurePolylength',
  arc: 'measureArc',
  volume: 'measureVolume',
  radius: 'measureRadius',
  raceway: 'measureRaceway',
});

const KIND_BASE = Object.freeze({
  raceway: 'measurePerimeter',
  polylength: 'measurePerimeter',
  arc: 'measurePerimeter',
  volume: 'measureArea',
  radius: 'measureDistance',
});

/** English names for the kind types (i18n: properties types.*). */
export const MEASURE_KIND_NAMES = Object.freeze({
  measurePolylength: 'Polylength',
  measureArc: 'Arc length',
  measureVolume: 'Volume',
  measureRadius: 'Radius',
  measureRaceway: 'Raceway',
});

/** Derived values the extras computation writes (cleared when unused). */
export const MEASURE_EXTRA_OUTPUTS = Object.freeze([
  'measureBaseValue', 'measureCalibrated', 'measureSegmentValues', 'measureSegmentTexts',
  'measureVolumeValue', 'measureVolumeUnit', 'measureWallAreaValue', 'measureWallAreaUnit',
  'measureFittings', 'measureBendTotal', 'measureBendWarning', 'measurePxPerIn', 'measureBendSections',
  'measureFillPercent', 'measureFillLimit', 'measureFillOver',
  'measureJunction',
]);

export const SLOPE_MODES = Object.freeze(['degree', 'grade', 'pitch']);
export const DEPTH_UNITS = Object.freeze(['mm', 'cm', 'm', 'in', 'ft', 'pt']);

const LENGTH_TO_MM = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 });

/** Arc measurements store this many segments along the arc (odd point count). */
export const ARC_SEGMENTS = 32;

/** Caption keys each base type can show, in display order. */
export const CAPTION_KEYS = Object.freeze({
  measureDistance: ['length', 'radius', 'wallArea', 'depth', 'slope'],
  measurePerimeter: ['length', 'radius', 'wallArea', 'depth', 'slope'],
  measureArea: ['area', 'volume', 'depth', 'slope'],
});

function validKind(ann) {
  const kind = ann?.measureKind;
  return kind && KIND_BASE[kind] === ann.type ? kind : null;
}

/** Type id of a measurement for lists and summaries ('measureVolume', ...). */
export function measureKindType(ann) {
  const kind = validKind(ann);
  return kind ? MEASURE_KIND_TYPES[kind] : ann?.type;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** True when the annotation needs the extras computation. */
export function hasMeasureExtras(ann) {
  if (!ann || !BASE_MEASURE_TYPES.includes(ann.type)) return false;
  return !!(validKind(ann) || positive(ann.measureDepth) != null
    || (SLOPE_MODES.includes(ann.measureSlopeMode) && Number.isFinite(Number(ann.measureSlope)))
    || ann.measureShowSegments || ann.measureShowCentroid || Array.isArray(ann.measureCaption));
}

/**
 * Factor from plan length/area to sloped length/area. Degree: 1/cos(a);
 * grade (rise per 100) and pitch (rise per 12): sqrt(1 + (rise/run)^2).
 * Invalid input gives 1 (no adjustment).
 */
export function slopeFactor(mode, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) return 1;
  if (mode === 'degree') return v < 90 ? 1 / Math.cos(v * Math.PI / 180) : 1;
  if (mode === 'grade') return Math.hypot(1, v / 100);
  if (mode === 'pitch') return Math.hypot(1, v / 12);
  return 1;
}

/** Convert a length between units; null when they cannot be converted (pt vs physical). */
export function convertLength(value, from, to) {
  if (!Number.isFinite(value)) return null;
  if (from === to) return value;
  const a = LENGTH_TO_MM[from], b = LENGTH_TO_MM[to];
  if (!a || !b) return null;
  return value * a / b;
}

/** Circle through three points, or null when they are (nearly) collinear. */
export function circleFrom3Points(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const span = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y),
    Math.hypot(c.x - a.x, c.y - a.y));
  if (!(span > 0) || Math.abs(d) < 1e-9 * span * span) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

/**
 * Arc from `start` through `through` to `end`: centre, radius, start angle and
 * signed sweep (radians). Null for collinear points.
 */
export function arcThrough3(start, through, end) {
  const c = circleFrom3Points(start, through, end);
  if (!c) return null;
  const a0 = Math.atan2(start.y - c.cy, start.x - c.cx);
  const am = Math.atan2(through.y - c.cy, through.x - c.cx);
  const a1 = Math.atan2(end.y - c.cy, end.x - c.cx);
  const norm = (v) => { let r = v % (2 * Math.PI); if (r < 0) r += 2 * Math.PI; return r; };
  const ccwEnd = norm(a1 - a0);
  const ccwMid = norm(am - a0);
  const sweep = ccwMid <= ccwEnd ? ccwEnd : ccwEnd - 2 * Math.PI;
  return { ...c, startAngle: a0, sweep };
}

/** Points along the arc (segments + 1); the middle point is the arc midpoint. */
export function densifyArc(start, through, end, segments = ARC_SEGMENTS) {
  const arc = arcThrough3(start, through, end);
  if (!arc) return null;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = arc.startAngle + arc.sweep * (i / segments);
    pts.push({ x: arc.cx + arc.r * Math.cos(t), y: arc.cy + arc.r * Math.sin(t) });
  }
  // Exact end points: no drift from the trigonometry.
  pts[0] = { x: start.x, y: start.y };
  pts[segments] = { x: end.x, y: end.y };
  return pts;
}

/** The arc stored in an arc measurement: through first, middle and last point. */
export function arcOfPoints(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  return arcThrough3(points[0], points[Math.floor(points.length / 2)], points[points.length - 1]);
}

/** Area-weighted centroid of a polygon; the vertex mean when it has no area. */
export function polygonCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length,
      y: points.reduce((s, p) => s + p.y, 0) / points.length,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function segmentPixels(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push(Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y));
  }
  return out;
}

function defaultCaption(ann, kind, hasDepth) {
  if (ann.type === 'measureArea') return kind === 'volume' ? ['volume'] : ['area'];
  if (kind === 'radius') return ['radius'];
  const keys = ['length'];
  if (kind === 'arc') keys.push('radius');
  if (hasDepth) keys.push('wallArea');
  return keys;
}

/**
 * Compute the extras of `ann` with `scale` ({pixelsPerUnit, unit, calibrated})
 * and the formatters `{ formatMeasurement, formatDimensionText }`. Returns the
 * properties to assign; the annotation is not changed. Arc measurements also
 * return re-densified `points` (the arc through first, middle, last point).
 */
export function computeMeasureExtras(ann, scale, fmt) {
  if (!hasMeasureExtras(ann)) return null;
  const kind = validKind(ann);
  if (kind === 'raceway') return computeRaceway(ann, scale, fmt);
  // A per-annotation scale override (units per point) is an explicit source.
  const override = ann.type === 'measureDistance' && positive(ann.measureScale);
  const ppu = override ? 1 / override : (positive(scale?.pixelsPerUnit) || 1);
  const unit = override ? (ann.measureUnit || 'mm') : (scale?.unit || 'pt');
  const calibrated = override ? unit !== 'pt' : scale?.calibrated === true;
  const slope = SLOPE_MODES.includes(ann.measureSlopeMode)
    ? slopeFactor(ann.measureSlopeMode, ann.measureSlope) : 1;
  const out = { measureUnit: ann.type === 'measureArea' ? unit + '²' : unit, measureCalibrated: calibrated };

  let length = null, area = null, radius = null, segments = null;
  if (ann.type === 'measureDistance') {
    const px = Math.hypot(ann.endX - ann.startX, ann.endY - ann.startY);
    if (!Number.isFinite(px)) return null;
    out.measurePixels = px;
    out.measureBaseValue = px / ppu;
    length = out.measureBaseValue * slope;
    if (kind === 'radius') radius = px / ppu;
  } else if (ann.type === 'measurePerimeter') {
    if (!Array.isArray(ann.points) || ann.points.length < 2) return null;
    let points = ann.points;
    if (kind === 'arc') {
      const arc = arcOfPoints(points);
      if (arc) {
        const mid = points[Math.floor(points.length / 2)];
        const dense = densifyArc(points[0], mid, points[points.length - 1], ARC_SEGMENTS);
        if (dense) { points = dense; out.points = dense; }
        out.measureBaseValue = arc.r * Math.abs(arc.sweep) / ppu;
        radius = arc.r / ppu;
      }
    }
    const segPx = segmentPixels(points);
    if (out.measureBaseValue == null) out.measureBaseValue = segPx.reduce((s, v) => s + v, 0) / ppu;
    length = out.measureBaseValue * slope;
    if (kind !== 'arc') segments = segPx.map(px => px * slope / ppu);
  } else {
    if (!Array.isArray(ann.points) || ann.points.length < 3) return null;
    // A finished measurement may pass the engine's page-point area. The
    // shoelace total stays when that figure is absent.
    const pixelArea = Number.isFinite(fmt?.pixelArea)
      ? fmt.pixelArea
      : nettoVlakOppervlak(ann.points, ann.holes);
    out.measureBaseValue = pixelArea / (ppu * ppu);
    area = out.measureBaseValue * slope;
  }
  out.measureValue = length ?? area;

  // Depth: stored with its own unit, converted into the measurement unit.
  const depthRaw = positive(ann.measureDepth);
  const depthUnit = DEPTH_UNITS.includes(ann.measureDepthUnit) ? ann.measureDepthUnit : unit;
  const depth = depthRaw == null ? null : convertLength(depthRaw, depthUnit, unit);
  const depthMismatch = depthRaw != null && depth == null;
  out.measureWallAreaValue = undefined; out.measureWallAreaUnit = undefined;
  out.measureVolumeValue = undefined; out.measureVolumeUnit = undefined;
  if (depth != null && length != null) {
    out.measureWallAreaValue = length * depth;
    out.measureWallAreaUnit = unit + '²';
  }
  if (depth != null && area != null && kind === 'volume') {
    out.measureVolumeValue = area * depth;
    out.measureVolumeUnit = unit + '³';
  }

  const show = (value, u, dimension = false) => {
    if (!calibrated) return `${Number((Number.isFinite(value) ? value : 0).toFixed(2))} ${u}`;
    // Lengths carry the scale's display precision (Set Scale); areas and
    // volumes ignore it in formatMeasurement.
    const m = { value, unit: u, calibrated: true,
      ...(!override && scale?.precision != null ? { precision: scale.precision } : {}) };
    return dimension ? fmt.formatDimensionText(m) : fmt.formatMeasurement(m);
  };

  out.measureSegmentValues = segments || undefined;
  out.measureSegmentTexts = segments ? segments.map(v => show(v, unit)) : undefined;

  const parts = {
    length: length != null ? show(length, unit, ann.type === 'measureDistance') : null,
    radius: radius != null ? `R ${show(radius, unit, ann.type === 'measureDistance')}` : null,
    area: area != null ? show(area, unit + '²') : null,
    wallArea: out.measureWallAreaValue != null ? `Wall ${show(out.measureWallAreaValue, out.measureWallAreaUnit)}` : null,
    volume: out.measureVolumeValue != null ? show(out.measureVolumeValue, out.measureVolumeUnit)
      : (kind === 'volume' ? (depthMismatch ? 'Depth unit does not match scale' : 'Depth not set') : null),
    depth: depthRaw != null ? `D ${Number(depthRaw.toFixed(3))} ${depthUnit}` : null,
    slope: slope !== 1 ? `Slope ${Number(Number(ann.measureSlope).toFixed(2))}${
      ann.measureSlopeMode === 'degree' ? '°' : ann.measureSlopeMode === 'grade' ? '%' : ':12'}` : null,
  };
  if (depthMismatch && kind !== 'volume') parts.wallArea = 'Depth unit does not match scale';
  const allowed = CAPTION_KEYS[ann.type];
  const wanted = Array.isArray(ann.measureCaption)
    ? ann.measureCaption.filter(k => allowed.includes(k))
    : defaultCaption(ann, kind, depthRaw != null);
  let shown = allowed.filter(k => wanted.includes(k) && parts[k]).map(k => parts[k]);
  if (!shown.length) shown = [parts.length || parts.area || parts.radius].filter(Boolean);
  out.measureText = (calibrated ? '' : 'Scale not set · ') + shown.join(' · ');
  return out;
}

/** Page points per inch for a scale, or null when it is not a physical calibration. */
export function pxPerInchOf(scale) {
  if (scale?.calibrated !== true) return null;
  const ppu = positive(scale.pixelsPerUnit);
  const inPerUnit = convertLength(1, scale.unit, 'in');
  return ppu && inPerUnit ? ppu / inPerUnit : null;
}

/**
 * A raceway run: the developed centre-line length (straight parts plus the
 * elbow arcs) in the scale's unit, the fittings and the bend total. The label
 * is e.g. '42\'-6" · 3/4" EMT · 2 × 90°, 1 × 45° · Bends 225°'; a conduit
 * over 360° of bends gets a warning (NEC, between pull points: phase 3 adds
 * pull points, so a whole run counts as one pull for now). Uncalibrated: page
 * units, sharp corners, 'Scale not set'.
 */
function computeRaceway(ann, scale, fmt) {
  if (!Array.isArray(ann.points) || ann.points.length < 2) return null;
  const rw = normalizeRaceway(ann.raceway);
  const ppu = positive(scale?.pixelsPerUnit) || 1;
  const unit = scale?.unit || 'pt';
  const calibrated = scale?.calibrated === true;
  const pxPerIn = calibrated ? pxPerInchOf(scale) : null;
  // A branch's tee / cross / reducer, from the runs in `fmt.annotations`.
  const junction = branchJunction(ann, fmt?.annotations);
  const geom = racewayGeometry(ann.points, rw, pxPerIn, junction);
  const value = geom.developedPx / ppu;
  // NEC: at most 360° between pull points, so the worst pull section counts.
  const bendWarning = rw.kind === 'conduit' && geom.bendMax > NEC_MAX_BENDS + 0.5;
  const lengthText = calibrated
    ? fmt.formatMeasurement({ value, unit, calibrated: true, ...(scale?.precision != null ? { precision: scale.precision } : {}) })
    : `${Number(value.toFixed(2))} ${unit}`;
  const parts = [lengthText, racewayLabel(rw)];
  if (rw.tag) parts.unshift(rw.tag);
  if (geom.fittings.length) parts.push(fittingsText(geom.fittings));
  if (rw.kind === 'conduit' && geom.bendTotal > 0) {
    parts.push(`${bendsText(geom.bendSections)}${bendWarning ? ` ⚠ over ${NEC_MAX_BENDS}°` : ''}`);
  }
  const fill = racewayFill(rw);
  if (fill.text) parts.push(fill.text);
  return {
    raceway: rw,
    measureUnit: unit,
    measureCalibrated: calibrated,
    measurePixels: geom.developedPx,
    measureBaseValue: value,
    measureValue: value,
    measureFittings: geom.fittings,
    measureBendTotal: geom.bendTotal,
    measureBendSections: geom.bendSections.length > 1 ? geom.bendSections : undefined,
    measureBendWarning: bendWarning || undefined,
    // The scale the drawing uses (true widths, elbow radii); undefined = symbolic.
    measurePxPerIn: pxPerIn || undefined,
    ...fill.out,
    measureJunction: junctionKey(junction) || undefined,
    measureSegmentValues: undefined,
    measureSegmentTexts: undefined,
    measureWallAreaValue: undefined, measureWallAreaUnit: undefined,
    measureVolumeValue: undefined, measureVolumeUnit: undefined,
    measureText: (calibrated ? '' : 'Scale not set · ') + parts.join(' · '),
  };
}

// ── Conduit fill hook (conduit-fill.js, NEC Chapter 9) ──
// The conductors in a conduit run: the label part ('Fill 13% (≤40%)' or
// '⚠ fill 44% > 40%') and the takeoff values; all undefined without conductors.
function racewayFill(rw) {
  const f = rw.kind === 'conduit' && rw.conductors?.length ? conduitFill(rw, rw.conductors) : null;
  const ok = f && f.fillPercent != null;
  return {
    text: ok ? fillText(f) : '',
    out: {
      measureFillPercent: ok ? f.fillPercent : undefined,
      measureFillLimit: ok ? f.limitPercent : undefined,
      measureFillOver: ok && f.over ? true : undefined,
    },
  };
}

/** Segment labels of a polyline measurement: text at each segment midpoint. */
export function segmentLabels(ann) {
  if (!ann?.measureShowSegments || ann.type !== 'measurePerimeter') return [];
  const texts = ann.measureSegmentTexts;
  const pts = ann.points;
  if (!Array.isArray(texts) || !Array.isArray(pts) || pts.length < 2) return [];
  const out = [];
  for (let i = 0; i < pts.length - 1 && i < texts.length; i++) {
    out.push({
      text: texts[i],
      x: (pts[i].x + pts[i + 1].x) / 2,
      y: (pts[i].y + pts[i + 1].y) / 2,
      angle: Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x),
    });
  }
  return out;
}

/** Centroid marker position of an area measurement, or null when hidden. */
export function centroidMarker(ann) {
  if (!ann?.measureShowCentroid || ann.type !== 'measureArea') return null;
  return polygonCentroid(ann.points);
}

// ── PDF persistence: one private text key with JSON ──

export const MEASURE_EXTRA_KEY = 'OPS_MeasureExtra';

const NUM = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

/** The JSON stored in /OPS_MeasureExtra, or null when there is nothing to store. */
export function measureExtrasToJson(ann) {
  if (!hasMeasureExtras(ann)) return null;
  const data = {
    v: 1,
    kind: validKind(ann) || undefined,
    depth: positive(ann.measureDepth) ?? undefined,
    depthUnit: DEPTH_UNITS.includes(ann.measureDepthUnit) ? ann.measureDepthUnit : undefined,
    slopeMode: SLOPE_MODES.includes(ann.measureSlopeMode) ? ann.measureSlopeMode : undefined,
    slope: SLOPE_MODES.includes(ann.measureSlopeMode) ? NUM(ann.measureSlope) : undefined,
    segs: ann.measureShowSegments ? true : undefined,
    centroid: ann.measureShowCentroid ? true : undefined,
    caption: Array.isArray(ann.measureCaption) ? ann.measureCaption.filter(k => typeof k === 'string') : undefined,
    rw: validKind(ann) === 'raceway' ? normalizeRaceway(ann.raceway) : undefined,
    // A run's id, so a branch (raceway.branchOf.id) finds its parent again.
    rid: validKind(ann) === 'raceway' && validRunId(ann.id) ? ann.id : undefined,
    out: {
      value: NUM(ann.measureValue),
      unit: typeof ann.measureUnit === 'string' ? ann.measureUnit : undefined,
      base: NUM(ann.measureBaseValue),
      cal: typeof ann.measureCalibrated === 'boolean' ? ann.measureCalibrated : undefined,
      segV: Array.isArray(ann.measureSegmentValues) ? ann.measureSegmentValues.map(NUM) : undefined,
      segT: Array.isArray(ann.measureSegmentTexts) ? ann.measureSegmentTexts.map(String) : undefined,
      vol: NUM(ann.measureVolumeValue),
      volU: ann.measureVolumeUnit || undefined,
      wall: NUM(ann.measureWallAreaValue),
      wallU: ann.measureWallAreaUnit || undefined,
      fit: Array.isArray(ann.measureFittings) ? ann.measureFittings : undefined,
      bend: NUM(ann.measureBendTotal),
      ppi: NUM(ann.measurePxPerIn),
      secs: Array.isArray(ann.measureBendSections) ? ann.measureBendSections.map(NUM) : undefined,
      fill: NUM(ann.measureFillPercent),
      fillLim: NUM(ann.measureFillLimit),
      fillOver: ann.measureFillOver === true ? true : undefined,
    },
  };
  return JSON.stringify(data);
}

/** Properties for a loaded measurement from the /OPS_MeasureExtra JSON. */
export function measureExtrasFromJson(type, json) {
  if (!BASE_MEASURE_TYPES.includes(type) || typeof json !== 'string') return null;
  let d;
  try { d = JSON.parse(json); } catch { return null; }
  if (!d || typeof d !== 'object' || d.v !== 1) return null;
  const props = {};
  if (d.kind && KIND_BASE[d.kind] === type) props.measureKind = d.kind;
  if (props.measureKind === 'raceway') props.raceway = normalizeRaceway(d.rw);
  if (props.measureKind === 'raceway' && validRunId(d.rid)) props.id = d.rid;
  if (positive(d.depth) != null) props.measureDepth = positive(d.depth);
  if (DEPTH_UNITS.includes(d.depthUnit)) props.measureDepthUnit = d.depthUnit;
  if (SLOPE_MODES.includes(d.slopeMode) && Number.isFinite(d.slope)) {
    props.measureSlopeMode = d.slopeMode;
    props.measureSlope = d.slope;
  }
  if (d.segs === true) props.measureShowSegments = true;
  if (d.centroid === true) props.measureShowCentroid = true;
  const allowed = CAPTION_KEYS[type];
  if (Array.isArray(d.caption)) props.measureCaption = d.caption.filter(k => allowed.includes(k));
  const o = d.out && typeof d.out === 'object' ? d.out : {};
  if (Number.isFinite(o.value)) props.measureValue = o.value;
  if (typeof o.unit === 'string' && o.unit) props.measureUnit = o.unit;
  if (Number.isFinite(o.base)) props.measureBaseValue = o.base;
  if (typeof o.cal === 'boolean') props.measureCalibrated = o.cal;
  if (Array.isArray(o.segV) && o.segV.every(Number.isFinite)) props.measureSegmentValues = o.segV;
  if (Array.isArray(o.segT) && o.segT.every(t => typeof t === 'string')) props.measureSegmentTexts = o.segT;
  if (Number.isFinite(o.vol) && typeof o.volU === 'string') {
    props.measureVolumeValue = o.vol; props.measureVolumeUnit = o.volU;
  }
  if (Array.isArray(o.fit) && o.fit.every(f => f && Number.isFinite(f.count))) {
    props.measureFittings = o.fit.map(f => ({
      angle: ['custom', 'up', 'down', 'pull', 'tee', 'cross', 'reducer'].includes(f.angle) ? f.angle : Number(f.angle), count: f.count,
    }));
  }
  if (Number.isFinite(o.bend)) props.measureBendTotal = o.bend;
  if (positive(o.ppi) != null) props.measurePxPerIn = positive(o.ppi);
  if (Array.isArray(o.secs) && o.secs.every(Number.isFinite)) props.measureBendSections = o.secs;
  if (Number.isFinite(o.fill) && o.fill >= 0) props.measureFillPercent = o.fill;
  if ([53, 31, 40].includes(o.fillLim)) props.measureFillLimit = o.fillLim;
  if (o.fillOver === true) props.measureFillOver = true;
  if (Number.isFinite(o.wall) && typeof o.wallU === 'string') {
    props.measureWallAreaValue = o.wall; props.measureWallAreaUnit = o.wallU;
  }
  return props;
}

/**
 * The value a summary/total of this measurement adds up: the volume for a
 * Volume, the measurement value otherwise.
 */
export function summaryValue(ann) {
  if (validKind(ann) === 'volume') {
    return Number.isFinite(ann.measureVolumeValue)
      ? { measureValue: ann.measureVolumeValue, measureUnit: ann.measureVolumeUnit }
      : { measureValue: undefined, measureUnit: undefined };
  }
  return { measureValue: ann.measureValue, measureUnit: ann.measureUnit };
}

/** Property keys the properties panel edits through setMeasureExtraProp. */
export const MEASURE_EXTRA_PROPS = Object.freeze([
  'measureDepth', 'measureDepthUnit', 'measureSlopeMode', 'measureSlope',
  'measureShowSegments', 'measureShowCentroid', 'measureCaption', 'raceway',
]);

/**
 * Write one extras property from the panel, normalised; empty clears it.
 * Returns false for a key that is not an extras property.
 */
export function setMeasureExtraProp(ann, key, value) {
  if (!MEASURE_EXTRA_PROPS.includes(key)) return false;
  const clear = value === '' || value === null || value === undefined;
  if (key === 'measureDepth') {
    ann.measureDepth = clear ? undefined : (positive(value) ?? undefined);
  } else if (key === 'measureDepthUnit') {
    ann.measureDepthUnit = DEPTH_UNITS.includes(value) ? value : undefined;
  } else if (key === 'measureSlopeMode') {
    ann.measureSlopeMode = SLOPE_MODES.includes(value) ? value : undefined;
    if (!ann.measureSlopeMode) ann.measureSlope = undefined;
  } else if (key === 'measureSlope') {
    const n = Number(value);
    ann.measureSlope = clear || !Number.isFinite(n) || n < 0 ? undefined : n;
  } else if (key === 'measureShowSegments' || key === 'measureShowCentroid') {
    ann[key] = value === true || value === 'true' ? true : undefined;
  } else if (key === 'raceway') {
    // A patch of the run's settings (conduit type/size/true size, tray
    // style/width/rail/rungs, elbow radius); the subject follows when it was
    // the automatic label.
    if (validKind(ann) !== 'raceway' || !value || typeof value !== 'object') return true;
    const before = normalizeRaceway(ann.raceway);
    const merged = { ...before, ...value };
    if (value.radiusIn === null || value.radiusIn === '') delete merged.radiusIn;
    if (value.kind && value.kind !== before.kind) delete merged.radiusIn;
    ann.raceway = normalizeRaceway(merged);
    if (!ann.subject || ann.subject === racewayLabel(before)) ann.subject = racewayLabel(ann.raceway);
  } else if (key === 'measureCaption') {
    const allowed = CAPTION_KEYS[ann.type] || [];
    ann.measureCaption = Array.isArray(value) ? allowed.filter(k => value.includes(k)) : undefined;
  }
  return true;
}

/** The caption keys a measurement currently shows (explicit or default). */
export function effectiveCaption(ann) {
  if (!ann || !CAPTION_KEYS[ann.type]) return [];
  if (Array.isArray(ann.measureCaption)) return ann.measureCaption.slice();
  return defaultCaption(ann, validKind(ann), positive(ann.measureDepth) != null);
}
