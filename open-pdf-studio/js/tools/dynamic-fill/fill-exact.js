// One committed Dynamic Fill may replace the raster contour with a closed
// GEOS face. Paint, a gap, a window of more than MAX_POLYGONIZE_SEGMENTS
// lines, and a missing command all keep the flood. Segments are already in
// annotation space (page points, y down); they are not flipped.

import { regionArea, regionContains, signedArea } from './fill-region.js';

export const MAX_POLYGONIZE_SEGMENTS = 800;

const PAD = 1;
const CLOSE = 1e-6;

function finitePoint(x, y) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function boundsOf(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    if (!finitePoint(point?.x, point?.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function overlaps(segment, box) {
  const x1 = Number(segment?.x1);
  const y1 = Number(segment?.y1);
  const x2 = Number(segment?.x2);
  const y2 = Number(segment?.y2);
  if (!finitePoint(x1, y1) || !finitePoint(x2, y2)) return false;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return maxX >= box.minX - PAD && minX <= box.maxX + PAD
    && maxY >= box.minY - PAD && minY <= box.maxY + PAD;
}

function asRing(raw) {
  if (!Array.isArray(raw)) return null;
  const points = [];
  for (const item of raw) {
    const x = Array.isArray(item) ? Number(item[0]) : Number(item?.x);
    const y = Array.isArray(item) ? Number(item[1]) : Number(item?.y);
    if (!finitePoint(x, y)) return null;
    points.push({ x, y });
  }
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= CLOSE) points.pop();
  }
  return points.length >= 3 ? points : null;
}

function withSign(ring, positive) {
  const area = signedArea(ring);
  if (!Number.isFinite(area) || area === 0 || (area > 0) === positive) return ring;
  return ring.slice().reverse();
}

/**
 * The smallest polygonized face that covers `seed`, or `region` unchanged.
 * `invoke` is the desktop command caller (`geos_polygonize`).
 */
export async function exactClosedFace(segments, seed, region, invoke) {
  if (!region || region.status !== 'ok' || !Array.isArray(region.outer)
    || typeof invoke !== 'function' || !finitePoint(seed?.x, seed?.y)) {
    return region;
  }
  const box = boundsOf(region.outer);
  if (!box) return region;
  const lines = [];
  const list = Array.isArray(segments) ? segments : [];
  for (const segment of list) {
    if (!overlaps(segment, box)) continue;
    lines.push([[segment.x1, segment.y1], [segment.x2, segment.y2]]);
    if (lines.length > MAX_POLYGONIZE_SEGMENTS) return region;
  }
  if (lines.length === 0) return region;
  let faces;
  try {
    faces = await invoke('geos_polygonize', { lines });
  } catch {
    return region;
  }
  if (!Array.isArray(faces) || faces.length === 0) return region;
  let best = null;
  for (const face of faces) {
    const outer = asRing(face?.shell);
    if (!outer) continue;
    const holes = [];
    if (Array.isArray(face?.holes)) {
      for (const hole of face.holes) {
        const ring = asRing(hole);
        if (ring) holes.push(ring);
      }
    }
    if (!Number.isFinite(face.area)) continue;
    if (!regionContains({ outer, holes }, seed.x, seed.y)) continue;
    if (!best || face.area < best.area) best = { outer, holes, area: face.area };
  }
  if (!best) return region;
  const outer = withSign(best.outer, true);
  const holes = best.holes.map((hole) => withSign(hole, false));
  if (outer.length < 3) return region;
  const area = regionArea({ outer, holes });
  if (!Number.isFinite(area)) return region;
  return { ...region, outer, holes, area };
}
