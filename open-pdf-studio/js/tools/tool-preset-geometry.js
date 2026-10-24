// Relative geometry for Tool Chest Drawing Mode. Never retain source page,
// coordinates, annotation ID, comment, or document path. Textbox display text
// is handled separately and only captured after an explicit UI choice.
const LINE_TYPES = new Set(['line', 'arrow']);
const BOX_TYPES = new Set(['box', 'circle', 'highlight', 'cloud', 'textbox', 'polygon', 'typewriter',
  'flag', 'stamp', 'symbol', 'group']);
// Point contours relative to their bounds (closed shapes).
const POINT_TYPES = new Set(['cloud', 'cloudPolyline', 'polygon']);
// Open vertex paths relative to their first vertex, which is the placement point.
const PATH_TYPES = new Set(['polyline']);
// Stamps and symbols are placed centred on the click, as without a preset.
const CENTRED_TYPES = new Set(['stamp', 'symbol']);
const MAX_SPAN = 100000;
const MAX_CLOUD_POINTS = 128;

// Annotation type of a Tool Chest tool when they differ (presetToolOf).
function toolOfAnnotation(annotation) {
  if (annotation.type === 'comment') return annotation.icon === 'flag' ? 'flag' : 'comment';
  if (annotation.type === 'stamp' && annotation.symbolId && (annotation.stampSvg || annotation.stampBaseSvg)) return 'symbol';
  return annotation.type;
}

function cleanPoint(point, signed) {
  return point && typeof point === 'object' && !Array.isArray(point) && Object.keys(point).length === 2 &&
    finite(point.x) && finite(point.y) &&
    (signed ? Math.abs(point.x) <= MAX_SPAN && Math.abs(point.y) <= MAX_SPAN
      : point.x >= 0 && point.y >= 0 && point.x <= MAX_SPAN && point.y <= MAX_SPAN);
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

export function cleanToolGeometry(tool, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (tool === 'callout' && value.kind === 'callout') {
    const keys = ['kind', 'boxDx', 'boxDy', 'width', 'height', 'kneeDx', 'kneeDy', 'armDx', 'armDy'];
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) ||
        keys.slice(1).some(key => !finite(value[key])) ||
        value.width <= 0 || value.height <= 0 || value.width > MAX_SPAN || value.height > MAX_SPAN ||
        keys.slice(1).some(key => Math.abs(value[key]) > MAX_SPAN) ||
        Math.hypot(value.boxDx, value.boxDy) < 0.01 ||
        Math.hypot(value.kneeDx, value.kneeDy) < 0.01 ||
        Math.hypot(value.armDx, value.armDy) < 0.01 ||
        !(Math.abs(value.armDx - value.boxDx) < 0.01 ||
          Math.abs(value.armDx - (value.boxDx + value.width)) < 0.01) ||
        value.armDy < value.boxDy - 0.01 ||
        value.armDy > value.boxDy + value.height + 0.01) return null;
    return Object.fromEntries(keys.map(key => [key, value[key]]));
  }
  if (PATH_TYPES.has(tool) && value.kind === 'path') {
    if (Object.keys(value).length !== 2 || !Array.isArray(value.points) ||
        value.points.length < 2 || value.points.length > MAX_CLOUD_POINTS) return null;
    const points = value.points;
    if (points.some(point => !cleanPoint(point, true)) || points[0].x !== 0 || points[0].y !== 0) return null;
    if (!points.some(point => Math.hypot(point.x, point.y) >= 0.01)) return null;
    return { kind: 'path', points: points.map(point => ({ x: point.x, y: point.y })) };
  }
  if (POINT_TYPES.has(tool) && value.kind === 'points') {
    if (Object.keys(value).length !== 2 || !Array.isArray(value.points) ||
        value.points.length < 3 || value.points.length > MAX_CLOUD_POINTS) return null;
    const points = value.points;
    if (points.some(point => !cleanPoint(point, false))) return null;
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const width = Math.max(...xs);
    const height = Math.max(...ys);
    if (Math.min(...xs) !== 0 || Math.min(...ys) !== 0 || width <= 0 || height <= 0) return null;
    const area = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
    if (area < 0.01) return null;
    return { kind: 'points', points: points.map(point => ({ x: point.x, y: point.y })) };
  }
  if (LINE_TYPES.has(tool)) {
    if (Object.keys(value).length !== 3 || value.kind !== 'line' ||
        !finite(value.dx) || !finite(value.dy) ||
        Math.hypot(value.dx, value.dy) < 0.01 || Math.hypot(value.dx, value.dy) > MAX_SPAN) return null;
    return { kind: 'line', dx: value.dx, dy: value.dy };
  }
  if (BOX_TYPES.has(tool)) {
    if (Object.keys(value).length !== 4 || value.kind !== 'box' ||
        !finite(value.width) || !finite(value.height) || !finite(value.rotation) ||
        value.width <= 0 || value.height <= 0 || value.width > MAX_SPAN || value.height > MAX_SPAN ||
        Math.abs(value.rotation) > 360) return null;
    return { kind: 'box', width: value.width, height: value.height, rotation: value.rotation };
  }
  return null;
}

export function captureToolGeometry(annotation) {
  if (!annotation) return null;
  const tool = toolOfAnnotation(annotation);
  if (tool === 'polyline' && Array.isArray(annotation.points) && annotation.points.length >= 2) {
    if (annotation.rotation || annotation.flipX || annotation.flipY ||
        annotation.points.length > MAX_CLOUD_POINTS ||
        annotation.points.some(point => !finite(point?.x) || !finite(point?.y))) return null;
    const [first] = annotation.points;
    return cleanToolGeometry('polyline', { kind: 'path',
      points: annotation.points.map(point => ({ x: point.x - first.x, y: point.y - first.y })) });
  }
  if (annotation.type === 'callout') {
    // Store offsets from the arrow tip; its new page position is the placement
    // anchor. A rotated/reflected box has a different leader contract.
    if (annotation.rotation || annotation.flipX || annotation.flipY ||
        ![annotation.x, annotation.y, annotation.width, annotation.height,
          annotation.arrowX, annotation.arrowY, annotation.kneeX, annotation.kneeY,
          annotation.armOriginX, annotation.armOriginY].every(finite)) return null;
    return cleanToolGeometry('callout', { kind: 'callout',
      boxDx: annotation.x - annotation.arrowX, boxDy: annotation.y - annotation.arrowY,
      width: annotation.width, height: annotation.height,
      kneeDx: annotation.kneeX - annotation.arrowX, kneeDy: annotation.kneeY - annotation.arrowY,
      armDx: annotation.armOriginX - annotation.arrowX,
      armDy: annotation.armOriginY - annotation.arrowY });
  }
  if (POINT_TYPES.has(tool) && Array.isArray(annotation.points) && annotation.points.length >= 3) {
    // A point cloud already has its own contour. Save only offsets from its
    // bounds; rotations/flips are not represented by PDF polygon vertices.
    if (annotation.rotation || annotation.flipX || annotation.flipY ||
        annotation.points.length > MAX_CLOUD_POINTS ||
        annotation.points.some(point => !finite(point?.x) || !finite(point?.y))) return null;
    const x = Math.min(...annotation.points.map(point => point.x));
    const y = Math.min(...annotation.points.map(point => point.y));
    return cleanToolGeometry(tool, { kind: 'points',
      points: annotation.points.map(point => ({ x: point.x - x, y: point.y - y })) });
  }
  if (LINE_TYPES.has(annotation.type)) {
    const { startX, startY, endX, endY } = annotation;
    if (![startX, startY, endX, endY].every(finite)) return null;
    return cleanToolGeometry(annotation.type, { kind: 'line', dx: endX - startX, dy: endY - startY });
  }
  if (BOX_TYPES.has(tool)) {
    // Text highlights can contain many quads. This first Drawing Mode slice
    // supports only simple drag-created rectangular highlights.
    if (annotation.type === 'highlight' && annotation.rects?.length) return null;
    if (!finite(annotation.x) || !finite(annotation.y)) return null;
    return cleanToolGeometry(tool, {
      kind: 'box', width: annotation.width, height: annotation.height,
      rotation: finite(annotation.rotation) ? annotation.rotation : 0,
    });
  }
  return null;
}

export function applyDrawingGeometry(tool, props, geometry, x, y) {
  const clean = cleanToolGeometry(tool, geometry);
  if (!props || !clean || !finite(x) || !finite(y) || toolOfAnnotation(props) !== tool) return props;
  if (clean.kind === 'callout') {
    return { ...props, x: x + clean.boxDx, y: y + clean.boxDy,
      width: clean.width, height: clean.height, arrowX: x, arrowY: y,
      kneeX: x + clean.kneeDx, kneeY: y + clean.kneeDy,
      armOriginX: x + clean.armDx, armOriginY: y + clean.armDy };
  }
  if (clean.kind === 'line') {
    return { ...props, startX: x, startY: y, endX: x + clean.dx, endY: y + clean.dy };
  }
  if (clean.kind === 'path') {
    return { ...props, points: clean.points.map(point => ({ x: x + point.x, y: y + point.y })) };
  }
  if (clean.kind === 'points') {
    const points = clean.points.map(point => ({ x: x + point.x, y: y + point.y }));
    return { ...props, x, y, width: Math.max(...clean.points.map(point => point.x)),
      height: Math.max(...clean.points.map(point => point.y)), points };
  }
  if (CENTRED_TYPES.has(tool)) {
    return { ...props, x: x - clean.width / 2, y: y - clean.height / 2,
      width: clean.width, height: clean.height, rotation: clean.rotation };
  }
  return { ...props, x, y, width: clean.width, height: clean.height, rotation: clean.rotation };
}

/**
 * Relative geometry resized by a factor (scale-aware tool sets): every
 * length and offset scales, rotation stays. Null when the result leaves the
 * geometry limits.
 */
export function scaleToolGeometry(tool, geometry, factor) {
  const clean = cleanToolGeometry(tool, geometry);
  if (!clean || !finite(factor) || factor <= 0) return null;
  if (factor === 1) return clean;
  const scalePoints = points => points.map(point => ({ x: point.x * factor, y: point.y * factor }));
  if (clean.kind === 'line') return cleanToolGeometry(tool, { ...clean, dx: clean.dx * factor, dy: clean.dy * factor });
  if (clean.kind === 'box') {
    return cleanToolGeometry(tool, { ...clean, width: clean.width * factor, height: clean.height * factor });
  }
  if (clean.kind === 'points' || clean.kind === 'path') {
    return cleanToolGeometry(tool, { kind: clean.kind, points: scalePoints(clean.points) });
  }
  if (clean.kind === 'callout') {
    return cleanToolGeometry(tool, Object.fromEntries(Object.entries(clean)
      .map(([key, value]) => [key, key === 'kind' ? value : value * factor])));
  }
  return null;
}
