// Creates conduit / cable tray runs (annotations/raceway.js) as measurePerimeter
// annotations with measureKind 'raceway', through the same creator as the
// Perimeter tool, so they calibrate via getMeasureScale, appear in the
// Measurements panel, Markups List and Quantities, and save/reopen as
// /PolyLine measurements (raceway data in /OPS_MeasureExtra).

import { state, getActiveDocument } from '../../core/state.js';
import { createMeasurePerimeterAnnotation } from '../annotation-creators.js';
import { refreshMeasureExtras } from '../../annotations/measurement.js';
import { normalizeRaceway, racewayLabel } from '../../annotations/raceway.js';

/** Default colours: conduit blue, tray green (preferences can change them). */
export const RACEWAY_COLORS = Object.freeze({ conduit: '#1c7ed6', tray: '#2b8a3e' });

/** Colour of a new run of this kind. */
export function racewayColor(kind, prefs = state.preferences || {}) {
  const v = kind === 'tray' ? prefs.racewayTrayColor : prefs.racewayConduitColor;
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : RACEWAY_COLORS[kind === 'tray' ? 'tray' : 'conduit'];
}

/** A run through `points` (annotation space) on `page`. */
export function createRacewayAnnotation(points, raceway, page = getActiveDocument()?.currentPage || 1) {
  const rw = normalizeRaceway(raceway);
  const ann = createMeasurePerimeterAnnotation(points.map((p) => ({ x: p.x, y: p.y })));
  if (!ann) return null;
  const color = racewayColor(rw.kind);
  Object.assign(ann, {
    page,
    measureKind: 'raceway',
    raceway: rw,
    color, strokeColor: color,
    lineWidth: rw.kind === 'tray' ? 0.75 : 1,
    borderStyle: 'solid',
    startHead: 'none', endHead: 'none',
    // The size label as subject: the legend, Markups List and Quantities
    // group runs by it ('3/4" EMT', '24" Ladder tray, 4" rail').
    subject: racewayLabel(rw),
  });
  refreshMeasureExtras(ann);
  return ann;
}
