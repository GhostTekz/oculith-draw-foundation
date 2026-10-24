// Creators for the plan-review measure kinds (annotations/measure-extras.js).
// Kept apart from the tool flows so they can be used without the canvas tool
// context (tests, MCP).

import { state, getActiveDocument } from '../core/state.js';
import { createAnnotation } from '../annotations/factory.js';
import { createMeasurePerimeterAnnotation, createMeasureAreaAnnotation } from './annotation-creators.js';
import { refreshMeasureExtras } from '../annotations/measurement.js';
import { densifyArc, circleFrom3Points, ARC_SEGMENTS, DEPTH_UNITS } from '../annotations/measure-extras.js';

/** Depth the next Volume starts with: the last depth entered (preferences). */
export function defaultVolumeDepth(prefs = state.preferences) {
  const depth = Number(prefs?.measureVolumeDepth);
  if (!(depth > 0)) return {};
  const unit = DEPTH_UNITS.includes(prefs.measureVolumeDepthUnit) ? prefs.measureVolumeDepthUnit : undefined;
  return { measureDepth: depth, ...(unit ? { measureDepthUnit: unit } : {}) };
}

/** Turn a freshly created base measurement into one of the extra kinds. */
export function asMeasureKind(ann, kind, extra = {}) {
  if (!ann) return ann;
  Object.assign(ann, { measureKind: kind, ...extra });
  refreshMeasureExtras(ann);
  return ann;
}

/** Polylength from the Perimeter click flow: total plus segment values. */
export function createPolylengthMeasurement(points) {
  return asMeasureKind(createMeasurePerimeterAnnotation(points), 'polylength', { measureShowSegments: true });
}

/** Volume from the Area click flow (holes included), with the last depth. */
export function createVolumeMeasurement(points, holes) {
  return asMeasureKind(createMeasureAreaAnnotation(points, holes), 'volume', defaultVolumeDepth());
}

/** Arc length measurement from start, a point on the arc and the end. */
export function createArcMeasurement(start, through, end) {
  const points = densifyArc(start, through, end, ARC_SEGMENTS);
  if (!points) return null;
  return asMeasureKind(createMeasurePerimeterAnnotation(points), 'arc');
}

/** 3-point radius: a centre -> rim dimension through the last point. */
export function createRadius3Measurement(a, b, c) {
  const circle = circleFrom3Points(a, b, c);
  if (!circle) return null;
  const prefs = state.preferences || {};
  const ann = createAnnotation({
    type: 'measureDistance',
    page: getActiveDocument()?.currentPage || 1,
    startX: circle.cx, startY: circle.cy, endX: c.x, endY: c.y,
    startHead: 'none', endHead: 'closed',
    headSize: prefs.measureDistHeadSize || 12,
    color: prefs.measureDistStrokeColor, strokeColor: prefs.measureDistStrokeColor,
    lineWidth: prefs.measureDistLineWidth,
    fontSize: prefs.measureDistFontSize || undefined,
    dimExtension: false,
    opacity: (prefs.measureDistOpacity || 100) / 100,
  });
  return asMeasureKind(ann, 'radius');
}
