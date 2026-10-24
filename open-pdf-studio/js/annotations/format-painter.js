// Format Painter (the external editor, Ctrl+Shift+C) and Multiply: the pure parts.
//
// Format Painter copies the appearance of one markup onto others of the same
// type family: colours, fill, line width and style, opacity and, for text
// markups, the font. Geometry, text, measurements and metadata stay.

const FAMILIES = [
  ['shape', ['box', 'circle', 'ellipse', 'polygon', 'cloud', 'cloudPolyline', 'lshape']],
  ['line', ['line', 'arrow', 'polyline', 'arc', 'spline', 'splineArrow', 'draw']],
  ['text', ['textbox', 'callout']],
  ['measure', ['measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle']],
  ['highlight', ['highlight', 'textHighlight', 'textUnderline', 'textStrikethrough', 'textSquiggly']],
];

const FAMILY_OF = new Map(FAMILIES.flatMap(([family, types]) => types.map(t => [t, family])));

/** Type family of a markup type; a type outside the table is its own family. */
export function formatFamily(type) {
  return FAMILY_OF.get(type) || `type:${type}`;
}

// Appearance keys per family. 'all' applies to every family.
const STYLE_KEYS = {
  all: ['color', 'strokeColor', 'opacity', 'fillOpacity', 'lineWidth', 'borderStyle', 'dashPattern', 'blendMode'],
  shape: ['fillColor', 'hatchPattern', 'hatchColor', 'hatchScale', 'cloudIntensity'],
  line: ['fillColor', 'startHead', 'endHead', 'headSize', 'lineCap'],
  text: ['fillColor', 'textColor', 'fontFamily', 'fontSize', 'fontBold', 'fontItalic', 'fontUnderline', 'textAlign'],
  measure: ['fillColor', 'textColor', 'fontFamily', 'fontSize', 'fontBold', 'fontItalic', 'startHead', 'endHead',
    'hatchPattern', 'hatchColor', 'hatchScale'],
  highlight: [],
};

/** May the appearance of `source` be painted on `target`? */
export function canPaintFormat(source, target) {
  if (!source || !target || source === target || source.id === target.id) return false;
  if (target.locked) return false;
  // Typewriter text and boxed text look alike in the model but not on paper.
  if (target.type === 'textbox' && !!target.noWrap !== !!source.noWrap) return false;
  return formatFamily(source.type) === formatFamily(target.type);
}

/**
 * The appearance of `source` as a patch for `target`: only keys the source
 * actually has (a missing key keeps the target's own value).
 */
export function formatPatch(source, target) {
  if (!canPaintFormat(source, target)) return null;
  const family = formatFamily(source.type);
  const keys = [...STYLE_KEYS.all, ...(STYLE_KEYS[family] || [])];
  const patch = {};
  for (const k of keys) {
    if (source[k] === undefined) continue;
    const v = source[k];
    patch[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return patch;
}

/**
 * Offsets of the copies Multiply makes: copy i (1..count) moves i x (dx, dy).
 * Returns [] for an invalid count; the count is capped at `max`.
 */
export function multiplyOffsets(count, dx, dy, max = 500) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) return [];
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [];
  return Array.from({ length: Math.min(n, max) }, (_, i) => ({ dx: dx * (i + 1), dy: dy * (i + 1) }));
}
