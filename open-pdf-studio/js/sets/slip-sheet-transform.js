// Slip sheet alignment: where a markup on the OLD revision lands on the NEW one.
//
// App markups store geometry in the page VIEW at scale 1 (PDF.js viewport:
// CropBox origin, /Rotate applied, Y down). Alignment is decided in PDF user
// space, so a CropBox offset or a different /Rotate on the new sheet keeps the
// drawing content under the markup:
//
//   view(old) --V_old^-1--> PDF(old) --P--> PDF(new) --V_new--> view(new)
//
// P is the page alignment (CropBox to CropBox; identity for unchanged sheets,
// a uniform scale about the centre for a re-plotted paper size). A two-point
// alignment replaces the whole chain with a similarity fixed by two picked
// point pairs in view coordinates. Compare's {dx, dy, rotation} offset uses
// the same matrix form (compareOffsetTransform). No app imports.

const EPS = 1e-9;

function finite(...values) {
  return values.every(value => typeof value === 'number' && Number.isFinite(value));
}

/** Matrices are [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (PDF/canvas order). */
export function multiply(m, n) {
  // m after n
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!finite(det) || Math.abs(det) < EPS) throw new Error('The page transform cannot be inverted.');
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function applyPoint(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

function viewportBox(viewport) {
  const box = viewport?.viewBox;
  if (!Array.isArray(box) || box.length !== 4 || !finite(...box)) throw new Error('A PDF.js page viewport is required.');
  return { x: Math.min(box[0], box[2]), y: Math.min(box[1], box[3]),
    width: Math.abs(box[2] - box[0]), height: Math.abs(box[3] - box[1]) };
}

function viewportMatrix(viewport) {
  const m = viewport?.transform;
  if (!Array.isArray(m) || m.length !== 6 || !finite(...m)) throw new Error('A PDF.js page viewport is required.');
  if (Math.abs((viewport.scale ?? 1) - 1) > 1e-6) throw new Error('Slip sheet alignment needs scale-one viewports.');
  return m;
}

/**
 * PDF user space of the old visible box to the new one. Equal sizes (within
 * `tolerance` points) translate CropBox origin to origin; a different paper
 * size scales uniformly to fit and centres.
 */
export function pageBoxTransform(oldBox, newBox, tolerance = 0.5) {
  if (!(oldBox.width > 0 && oldBox.height > 0 && newBox.width > 0 && newBox.height > 0)) {
    throw new Error('Both pages need a visible area.');
  }
  const sameSize = Math.abs(oldBox.width - newBox.width) <= tolerance
    && Math.abs(oldBox.height - newBox.height) <= tolerance;
  const scale = sameSize ? 1 : Math.min(newBox.width / oldBox.width, newBox.height / oldBox.height);
  const ox = oldBox.x + oldBox.width / 2;
  const oy = oldBox.y + oldBox.height / 2;
  const nx = newBox.x + newBox.width / 2;
  const ny = newBox.y + newBox.height / 2;
  return { matrix: [scale, 0, 0, scale, nx - scale * ox, ny - scale * oy], sameSize };
}

/** Automatic page alignment between two scale-one PDF.js viewports (view to view). */
export function pageAlignTransform(oldViewport, newViewport, tolerance = 0.5) {
  const { matrix, sameSize } = pageBoxTransform(viewportBox(oldViewport), viewportBox(newViewport), tolerance);
  const view = multiply(viewportMatrix(newViewport), multiply(matrix, invert(viewportMatrix(oldViewport))));
  return { matrix: view, mode: 'page', sameSize };
}

/** Similarity that maps old view points A, B onto new view points A', B'. */
export function twoPointTransform(oldA, oldB, newA, newB) {
  if (![oldA, oldB, newA, newB].every(p => p && finite(p.x, p.y))) throw new Error('Four finite alignment points are required.');
  const ox = oldB.x - oldA.x;
  const oy = oldB.y - oldA.y;
  const nx = newB.x - newA.x;
  const ny = newB.y - newA.y;
  const length = ox * ox + oy * oy;
  if (length < 1) throw new Error('The two alignment points on the old sheet must be at least 1 pt apart.');
  if (nx * nx + ny * ny < 1) throw new Error('The two alignment points on the new sheet must be at least 1 pt apart.');
  // Complex division m = (nB - nA) / (oB - oA): scale and rotation in one.
  const a = (nx * ox + ny * oy) / length;
  const b = (ny * ox - nx * oy) / length;
  return { matrix: [a, b, -b, a, newA.x - (a * oldA.x - b * oldA.y), newA.y - (b * oldA.x + a * oldA.y)], mode: 'twoPoint' };
}

/**
 * Compare's alignment offset ({dx, dy} in display pixels at `visualScale`,
 * rotation in degrees about the new page centre) as a view matrix.
 */
export function compareOffsetTransform(offset, newSize, visualScale = 1.5) {
  const dx = (offset?.dx || 0) / visualScale;
  const dy = (offset?.dy || 0) / visualScale;
  const rad = ((offset?.rotation || 0) * Math.PI) / 180;
  const cx = (newSize?.width || 0) / 2;
  const cy = (newSize?.height || 0) / 2;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
  return { matrix: multiply([1, 0, 0, 1, dx, dy], rotate), mode: 'compare' };
}

/** Scale and rotation of a similarity matrix; throws on shear or a mirror. */
export function similarityParts(m) {
  if (!Array.isArray(m) || m.length !== 6 || !finite(...m)) throw new Error('A finite alignment matrix is required.');
  const scale = Math.hypot(m[0], m[1]);
  if (scale < EPS || Math.abs(m[0] - m[3]) > 1e-6 * Math.max(1, scale) || Math.abs(m[1] + m[2]) > 1e-6 * Math.max(1, scale)) {
    throw new Error('Slip sheet alignment supports moving, rotating and uniform scaling only.');
  }
  let rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  if (Math.abs(rotation - Math.round(rotation)) < 1e-6) rotation = Math.round(rotation);
  rotation = ((rotation % 360) + 360) % 360;
  return { scale: Math.abs(scale - 1) < 1e-9 ? 1 : scale, rotation };
}

export function isIdentity(m, tolerance = 1e-6) {
  return m.every((value, index) => Math.abs(value - IDENTITY[index]) <= tolerance);
}

// Geometry fields of the app markup model (see the move/rotate walkers in
// annotations/transforms.js, plus the callout leader).
const POINT_PAIRS = [
  ['startX', 'startY'], ['endX', 'endY'], ['leaderStartX', 'leaderStartY'], ['leaderEndX', 'leaderEndY'],
  ['labelX', 'labelY'], ['cx', 'cy'], ['arrowX', 'arrowY'], ['armOriginX', 'armOriginY'], ['kneeX', 'kneeY'],
];
const POINT_OBJECTS = ['at', 'vertex', 'point1', 'point2'];
const POINT_ARRAYS = ['points', 'path', 'controlPoints', 'vertices'];
const LENGTHS = ['radius', 'arcRadius', 'radiusX', 'radiusY'];
// Types whose renderer honours `rotation` (annotations/transforms.js).
const ROTATION_FIELD_TYPES = new Set([
  'image', 'stamp', 'signature', 'comment', 'box', 'mask', 'circle', 'highlight',
  'polygon', 'cloud', 'textbox', 'parametricSymbol', 'scaleBar', 'scheduleTable',
]);

function mapPoint(m, point) {
  if (!point || typeof point !== 'object' || !finite(point.x, point.y)) return point;
  const mapped = applyPoint(m, point.x, point.y);
  return { ...point, x: mapped.x, y: mapped.y };
}

/**
 * Move one markup model (in place) with a view-space similarity matrix.
 * Rect-anchored markups keep their size (times the scale) and orbit by
 * their centre; a rotation adds to their `rotation` where the renderer reads
 * it, or swaps width and height for a quarter turn.
 */
export function transformMarkupGeometry(annotation, m) {
  if (isIdentity(m, 0)) return annotation;
  const { scale, rotation } = similarityParts(m);
  const quarter = Math.abs(rotation - 90) < 1e-6 || Math.abs(rotation - 270) < 1e-6;
  if (finite(annotation.x, annotation.y)) {
    if (finite(annotation.width, annotation.height)) {
      const centre = applyPoint(m, annotation.x + annotation.width / 2, annotation.y + annotation.height / 2);
      let width = annotation.width * scale;
      let height = annotation.height * scale;
      if (rotation && ROTATION_FIELD_TYPES.has(annotation.type)) {
        annotation.rotation = ((((annotation.rotation || 0) + rotation) % 360) + 360) % 360;
      } else if (quarter) {
        [width, height] = [height, width];
      }
      annotation.width = width;
      annotation.height = height;
      annotation.x = centre.x - width / 2;
      annotation.y = centre.y - height / 2;
    } else {
      Object.assign(annotation, applyPoint(m, annotation.x, annotation.y));
    }
  }
  for (const [kx, ky] of POINT_PAIRS) {
    if (!finite(annotation[kx], annotation[ky])) continue;
    const mapped = applyPoint(m, annotation[kx], annotation[ky]);
    annotation[kx] = mapped.x;
    annotation[ky] = mapped.y;
  }
  for (const key of POINT_OBJECTS) {
    if (annotation[key] && typeof annotation[key] === 'object') annotation[key] = mapPoint(m, annotation[key]);
  }
  for (const key of POINT_ARRAYS) {
    if (Array.isArray(annotation[key])) annotation[key] = annotation[key].map(point => mapPoint(m, point));
  }
  if (Array.isArray(annotation.holes)) {
    annotation.holes = annotation.holes.map(hole => (Array.isArray(hole) ? hole.map(point => mapPoint(m, point)) : hole));
  }
  if (Array.isArray(annotation.rects)) {
    annotation.rects = annotation.rects.map(rect => {
      if (!rect || !finite(rect.x, rect.y, rect.width, rect.height)) return rect;
      const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height],
        [rect.x + rect.width, rect.y + rect.height]].map(([x, y]) => applyPoint(m, x, y));
      const xs = corners.map(point => point.x);
      const ys = corners.map(point => point.y);
      return { ...rect, x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    });
  }
  if (Array.isArray(annotation.quadPoints)) {
    annotation.quadPoints = annotation.quadPoints.map(quad => {
      if (!Array.isArray(quad)) return quad;
      const out = quad.slice();
      for (let index = 0; index + 1 < out.length; index += 2) {
        if (!finite(out[index], out[index + 1])) continue;
        const mapped = applyPoint(m, out[index], out[index + 1]);
        out[index] = mapped.x;
        out[index + 1] = mapped.y;
      }
      return out;
    });
  }
  if (Array.isArray(annotation.leaders)) {
    annotation.leaders = annotation.leaders.map(leader => {
      if (!leader || typeof leader !== 'object') return leader;
      const out = { ...leader };
      for (const [kx, ky] of [['tipX', 'tipY'], ['kneeX', 'kneeY']]) {
        if (!finite(out[kx], out[ky])) continue;
        const mapped = applyPoint(m, out[kx], out[ky]);
        out[kx] = mapped.x;
        out[ky] = mapped.y;
      }
      return out;
    });
  }
  if (scale !== 1) {
    for (const key of LENGTHS) if (finite(annotation[key])) annotation[key] *= scale;
  }
  return annotation;
}
