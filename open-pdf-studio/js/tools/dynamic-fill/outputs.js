// Dynamic Fill outputs: turn the filled regions into ordinary markups — an
// Area measurement (default), Perimeter, Polylength or Volume measurements,
// and/or a plain Polygon (filled area) markup. They are built by the same
// creators as the hand-drawn tools, so they calibrate through getMeasureScale,
// show uncalibrated values as page units, and save/reopen like any other
// markup.

import { state, getActiveDocument } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { calculateArea, calculatePerimeter, formatMeasurement, refreshMeasureExtras } from '../../annotations/measurement.js';
import { createMeasureAreaAnnotation, createMeasurePerimeterAnnotation } from '../annotation-creators.js';
import { createPolylengthMeasurement, createVolumeMeasurement } from '../measure-extra-creators.js';
import { randkleurenUitVoorkeur } from '../../annotations/fill-utils.js';
import { vlakOmhullende } from '../../annotations/vlak-ringen.js';
import { regionsToRings, closedPath, regionContains, DYNAMIC_FILL_OUTPUTS } from './fill-region.js';
import { RUIMTE_VLAKSTIJL, labelPunt } from '../../plattegrond/ruimte.js';
import { isRuimteVlak } from '../../plattegrond/ruimte-koppeling.js';
import { RUIMTETAG_ID, RUIMTETAG_STIJL, RUIMTETAG_TEKST_PT, ruimteTagVak } from '../../symbols/templates/ruimtetag.js';

export { DYNAMIC_FILL_OUTPUTS };

const copy = (ring) => ring.map((p) => ({ x: p.x, y: p.y }));

// The creators label with the current page's scale. A fill applied after the
// view moved to another page (continuous mode) is relabelled with the scale
// of its own page.
function onPage(ann, page) {
  if (!ann || ann.page === page) return ann;
  ann.page = page;
  const m = ann.type === 'measureArea'
    ? calculateArea(ann.points, ann.holes, page)
    : calculatePerimeter(ann.points, page);
  ann.measureText = formatMeasurement(m);
  ann.measureValue = m.value;
  ann.measureUnit = m.unit;
  refreshMeasureExtras(ann);
  void import('../../annotations/geos-area.js').then((mod) => mod.scheduleAreaRefine(ann));
  return ann;
}

/** A plain filled polygon (the Filled Area markup), islands as holes. */
function polygonAnnotation(points, holes, page) {
  const prefs = state.preferences || {};
  const props = {
    type: 'filledArea',
    page,
    points,
    ...randkleurenUitVoorkeur(prefs, 'filledArea', 'filledArea'),
    fillColor: prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc'),
    lineWidth: prefs.filledAreaLineWidth ?? 1,
    borderStyle: prefs.filledAreaBorderStyle || 'solid',
    opacity: (prefs.filledAreaOpacity ?? 100) / 100,
    hatchPattern: prefs.filledAreaHatchPattern || 'none',
    hatchColor: prefs.filledAreaHatchColor || '#000000',
    hatchScale: prefs.filledAreaHatchScale ?? 100,
    hatchAngle: prefs.filledAreaHatchAngle ?? 0,
  };
  if (holes.length) props.holes = holes;
  const box = vlakOmhullende(points, holes);
  Object.assign(props, { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY });
  return createAnnotation(props);
}

/** A point inside the region (not in an island) for the room's seed and tag. */
function insidePoint(region) {
  const p = labelPunt(region.outer);
  if (p && regionContains(region, p.x, p.y)) return p;
  // Centroid in a column or a notch: scan the bounding box for an inside point.
  const xs = region.outer.map((q) => q.x), ys = region.outer.map((q) => q.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let n = 4; n <= 64; n *= 2) {
    for (let j = 1; j < n; j++) {
      for (let i = 1; i < n; i++) {
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * j / n;
        if (regionContains(region, x, y)) return { x, y };
      }
    }
  }
  return region.outer[0];
}

/**
 * Space (the external editor): one room per region in the floor-plan model
 * (plattegrond/ruimte-koppeling.js) — a measureArea with the room's name,
 * number and seed in the quiet room style, and a room tag at its label point
 * that shows the name, number and the room's own area text (ft² stays ft²).
 * Numbers continue after the rooms already on the page.
 */
function spaceAnnotations(regions, page, name) {
  const doc = getActiveDocument();
  let number = (doc?.annotations || []).filter((a) => isRuimteVlak(a) && (a.page ?? 1) === page).length;
  const out = [];
  for (const r of regions.filter((x) => x?.outer?.length >= 3)) {
    const holes = r.holes.map(copy);
    const room = onPage(createMeasureAreaAnnotation(copy(r.outer), holes.length ? holes : undefined), page);
    if (!room) continue;
    const seed = insidePoint(r);
    const nummer = String(++number);
    Object.assign(room, {
      ...RUIMTE_VLAKSTIJL,
      measureName: name,
      opsRuimteNaam: name,
      opsRuimteNummer: nummer,
      opsRuimteZaad: { x: seed.x, y: seed.y },
    });
    out.push(room);
    const params = {
      naam: name, nummer, decimalen: 1, toonOppervlakte: true,
      oppervlakteTekst: room.measureText,
      zaadX: seed.x, zaadY: seed.y, ankerX: seed.x, ankerY: seed.y,
    };
    out.push(createAnnotation({
      type: 'parametricSymbol', page, ...RUIMTETAG_STIJL, symbolId: RUIMTETAG_ID,
      ...ruimteTagVak(seed, params, RUIMTETAG_TEKST_PT), params,
    }));
  }
  return out;
}

/** The markups of one output kind (see createDynamicFillAnnotations). */
function annotationsFor(regions, output, page, opts = {}) {
  if (output === 'space') return spaceAnnotations(regions, page, opts.spaceName || 'Space');
  const rings = regionsToRings(regions);
  if (!rings) return [];
  const points = copy(rings.points);
  const holes = rings.holes.map(copy);
  if (output === 'polygon') return [polygonAnnotation(points, holes, page)];
  if (output === 'perimeter' || output === 'polylength') {
    return regions.filter((r) => r?.outer?.length >= 3).map((r) => {
      const path = closedPath(copy(r.outer));
      const ann = output === 'polylength' ? createPolylengthMeasurement(path) : createMeasurePerimeterAnnotation(path);
      return onPage(ann, page);
    }).filter(Boolean);
  }
  const hs = holes.length ? holes : undefined;
  const ann = output === 'volume' ? createVolumeMeasurement(points, hs) : createMeasureAreaAnnotation(points, hs);
  return [onPage(ann, page)].filter(Boolean);
}

/**
 * The markups for `regions` (fill-region.js results on `page`), for one
 * output or a list of them (the external editor: one or more of the Create options), in
 * DYNAMIC_FILL_OUTPUTS order. opts.spaceName names Spaces (default 'Space').
 * space: a room and its tag per region (see spaceAnnotations).
 * area/volume/polygon: one markup; the first region is the outer ring and
 * every other ring (islands, further regions) goes in `holes`, which
 * vlak-ringen.js sorts into cut-outs and extra parts. Volume starts with the
 * last depth entered. perimeter/polylength: one closed measurement per
 * region along its outer boundary.
 */
export function createDynamicFillAnnotations(regions, outputs = 'area', page = getActiveDocument()?.currentPage || 1, opts = {}) {
  const wanted = new Set(Array.isArray(outputs) ? outputs : [outputs]);
  return DYNAMIC_FILL_OUTPUTS.filter((id) => wanted.has(id)).flatMap((id) => annotationsFor(regions, id, page, opts));
}
