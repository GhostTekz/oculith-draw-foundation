// Scale entry: the pure rules behind Calibrate, Set Scale, the scale region
// dialog and the status-bar scale indicator. No app state, so node can test
// every rule that turns typed text into a physical calibration.
//
// PDF user space is 1/72 inch on paper. A drawing at 1:N shows one real unit
// as (72 * inchesPerUnit / N) points.

import { $RAW } from 'solid-js/store';
import { geldigeDocumentSchaal, schaalOpPunt, paginaSchaal } from './schaal-op-punt.js';

export const SCALE_UNITS = ['mm', 'cm', 'm', 'in', 'ft'];

export const INCHES_PER_UNIT = { mm: 1 / 25.4, cm: 1 / 2.54, m: 1 / 0.0254, in: 1, ft: 12 };

/**
 * PDF points per real unit for a 1:N drawing scale.
 * 1:48 in ft (1/4" = 1'-0") gives 18 pt per foot.
 * @param {number} denominator N of 1:N
 * @param {string} unit one of SCALE_UNITS
 * @returns {number|null}
 */
export function ratioPixelsPerUnit(denominator, unit) {
  const n = Number(denominator);
  const inches = INCHES_PER_UNIT[unit];
  if (!inches || !Number.isFinite(n) || n <= 0) return null;
  const ppu = (72 * inches) / n;
  return Number.isFinite(ppu) && ppu > 0 ? ppu : null;
}

/**
 * The 1:N denominator that a points-per-unit calibration is equivalent to.
 * @returns {number|null}
 */
export function ratioFromPixelsPerUnit(pixelsPerUnit, unit) {
  const inches = INCHES_PER_UNIT[unit];
  if (!inches || !Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) return null;
  const n = (72 * inches) / pixelsPerUnit;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "1:100", "1:53.4" — whole numbers when the ratio is (nearly) whole. */
export function formatRatio(denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return '';
  const rounded = Math.round(denominator);
  if (Math.abs(denominator - rounded) < 0.005 * Math.max(1, rounded) && rounded >= 1) {
    return `1:${rounded}`;
  }
  return `1:${Number(denominator.toPrecision(4))}`;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`;
const toNumber = (s) => parseFloat(String(s).replace(',', '.'));

// Imperial lengths: 10'-6", 10' 6", 10', 6", 10'-6 1/2", 10 ft 6 in.
const FEET_INCH = new RegExp(String.raw`^(?:${NUM}\s*(?:'|\u2032|ft|feet|foot))?\s*-?\s*`
  + String.raw`(?:${NUM}?(?:\s*(\d+)\/(\d+))?\s*(?:"|\u2033|in|inch|inches))?$`, 'i');

function parseFeetInch(text) {
  const m = text.match(FEET_INCH);
  if (!m) return null;
  const [, feetRaw, inchRaw, fracNum, fracDen] = m;
  const hasFeet = feetRaw != null;
  const hasInch = inchRaw != null || fracNum != null;
  if (!hasFeet && !hasInch) return null;
  let inches = 0;
  if (hasFeet) inches += toNumber(feetRaw) * 12;
  if (inchRaw != null) inches += toNumber(inchRaw);
  if (fracNum != null) {
    const den = Number(fracDen);
    if (!den) return null;
    inches += Number(fracNum) / den;
  }
  return { inches, hasFeet, hasInch };
}

const UNIT_ALIASES = {
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
};

/**
 * Parse a typed real-world length. Metric values take an optional unit
 * (mm/cm/m, else fallbackUnit). Imperial values accept feet-inch notation;
 * when the current unit is ft or in the result is in that unit, otherwise in
 * feet (or inches when only inches were typed).
 * Only the five supported measurement units are ever returned.
 * @param {string} input
 * @param {string} fallbackUnit
 * @returns {{value:number, unit:string} | null}
 */
export function parseLengthInput(input, fallbackUnit = 'mm') {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const fallback = SCALE_UNITS.includes(fallbackUnit) ? fallbackUnit : 'mm';

  let value;
  let unit;
  const metric = text.match(new RegExp(String.raw`^${NUM}\s*([a-z]+)?$`, 'i'));
  if (metric && (!metric[2] || UNIT_ALIASES[metric[2].toLowerCase()])) {
    value = toNumber(metric[1]);
    unit = metric[2] ? UNIT_ALIASES[metric[2].toLowerCase()] : fallback;
  } else {
    const imperial = parseFeetInch(text);
    if (!imperial) return null;
    if (fallback === 'in' || fallback === 'ft') unit = fallback;
    else unit = imperial.hasFeet ? 'ft' : 'in';
    value = unit === 'ft' ? imperial.inches / 12 : imperial.inches;
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, unit };
}

/**
 * Parse a drawing scale typed by the user. Accepts "1:N", "1/N" and
 * architectural scales such as 1/4" = 1'-0" (= 1:48). Any other ratio
 * (2:1, 1:0, text) is rejected rather than replaced by a default.
 * @returns {number|null} the denominator N
 */
export function parseRatioInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const eq = text.indexOf('=');
  if (eq !== -1) {
    const paper = parseLengthInput(text.slice(0, eq), 'in');
    const real = parseLengthInput(text.slice(eq + 1), 'ft');
    if (!paper || !real) return null;
    const paperIn = paper.value * INCHES_PER_UNIT[paper.unit];
    const realIn = real.value * INCHES_PER_UNIT[real.unit];
    const n = realIn / paperIn;
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m = text.replace(/\s+/g, '').match(new RegExp(String.raw`^${NUM}[:/]${NUM}$`));
  if (!m) return null;
  const a = toNumber(m[1]);
  const b = toNumber(m[2]);
  if (a !== 1 || !Number.isFinite(b) || b <= 0) return null;
  return b;
}

/** "1:N" for valid input, null otherwise. */
export function normalizeRatioInput(input) {
  const n = parseRatioInput(input);
  return n == null ? null : `1:${Number(n.toPrecision(6))}`;
}

/**
 * The scale that applies to a page as a whole, for the status bar: the page
 * scale (doc.pageScales, else a full-page PDF /VP), a scale bar, the
 * document fallback. Regions, viewports and PDF viewports smaller than the
 * page are point-specific; they are only reported as present (`regions`),
 * never as the page scale.
 * @param {object|null} doc
 * @param {number} pageNum
 * @param {object|null} [legacyScale] state.preferences.measureScale
 * @returns {{kind:'set', ratio:string, unit:string, method:string, regions:boolean}
 *   | {kind:'detected', ratio:string, regions:boolean}
 *   | {kind:'none', regions:boolean} | null}
 */
export function pageScaleStatus(doc, pageNum, legacyScale = null) {
  if (!doc) return null;
  // The length through the store (a markup added or removed counts), the
  // scan over the raw array: through the store it touched every markup's
  // proxy, and this runs for the status bar on every change.
  const tracked = Array.isArray(doc.annotations) ? doc.annotations : [];
  void tracked.length;
  const annotations = tracked[$RAW] || tracked;
  const regions = annotations.some(a => a.page === pageNum
    && (a.type === 'scaleRegion' || a.type === 'viewport'))
    || (Array.isArray(doc.pdfViewports?.[pageNum])
      && doc.pdfViewports[pageNum].some(v => v.paginaSchaal !== true));

  // NaN coordinates: no point-bound source matches, the page-wide order stays.
  let scale = schaalOpPunt(doc, pageNum, NaN, NaN);
  let method = scale?.method;
  if (scale && method === 'document') method = doc.measureScale?.method || 'document';
  let source = null;
  if (scale && method === 'page') {
    const own = paginaSchaal(doc, pageNum);
    method = own?.method || 'page';
    source = own?.source || null;
  }
  if (!scale) {
    const legacy = geldigeDocumentSchaal(legacyScale);
    if (legacy) { scale = legacy; method = 'preference'; }
  }
  // Scale proposals read from this page (scale-proposals.js): only a
  // suggestion until the user applies them.
  const entry = doc.scaleProposals?.[pageNum];
  const pendingPage = entry?.pageScale?.status === 'pending' ? entry.pageScale : null;
  const pendingViews = (entry?.views || []).filter(v => v?.status === 'pending');
  if (scale) {
    const status = {
      kind: 'set',
      ratio: formatRatio(ratioFromPixelsPerUnit(scale.pixelsPerUnit, scale.unit)),
      unit: scale.unit,
      method,
      regions,
    };
    if (typeof source === 'string' && source) status.source = source;
    if (pendingViews.length) status.pendingViews = pendingViews.length;
    return status;
  }
  if (entry) {
    if (pendingPage || pendingViews.length) {
      const first = pendingPage || pendingViews[0];
      return {
        kind: 'detected', ratio: pendingPage ? formatRatio(pendingPage.ratio) : '', regions,
        views: pendingViews.length, sourceText: first.sourceText || first.text || '',
        source: first.source, title: first.title || '', confidence: first.confidence,
      };
    }
    return { kind: 'none', regions };
  }
  const detected = Number(doc.detectedScale?.ratio);
  if (Number.isFinite(detected) && detected > 0) {
    return { kind: 'detected', ratio: formatRatio(detected), regions };
  }
  return { kind: 'none', regions };
}
