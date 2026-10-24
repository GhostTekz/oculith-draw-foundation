// Dimension types (maatlijn-typen) — CAD-style dimension presets.
//
// Each type is named after its TEXT HEIGHT ON PAPER in millimetres (the
// drafting convention: 1.8 / 2.5 / 3.5 / 5.0 mm lettering). Picking a type
// sets the label text size, the pen (line) width — text height / 10, per
// ISO pen pairing — a proportional arrow/tick size, and a fixed colour so
// dimensions of the same type are visually consistent across the drawing.
//
// All values are in PDF points (1 mm = 72/25.4 pt) because annotations are
// stored in page space at scale 1.

const MM_TO_PT = 72 / 25.4;

// `unit` is the measurement unit lengths are CALCULATED in for dimensions of
// this type (shown behind the text height in the type selector). Inside a
// scale region the region's unit still wins — this is the default for
// dimensions placed outside any scale source.
export const DIMENSION_TYPES = [
  { id: '1.8', label: '1.8 mm', textMm: 1.8, unit: 'mm', color: '#D32F2F' }, // rood
  { id: '2.5', label: '2.5 mm', textMm: 2.5, unit: 'mm', color: '#000000' }, // zwart
  { id: '3.5', label: '3.5 mm', textMm: 3.5, unit: 'mm', color: '#1565C0' }, // blauw
  { id: '5.0', label: '5.0 mm', textMm: 5.0, unit: 'mm', color: '#2E7D32' }, // groen
];

// Resolve a type id ('2.5') to the annotation property set it implies.
// Returns null for unknown ids.
export function dimensionTypeProps(typeId) {
  const t = DIMENSION_TYPES.find((d) => d.id === typeId);
  if (!t) return null;
  const fontPt = t.textMm * MM_TO_PT;
  return {
    dimType: t.id,
    fontSize: Math.round(fontPt),                          // label height
    lineWidth: Math.round((t.textMm / 10) * MM_TO_PT * 100) / 100, // pen = h/10
    headSize: Math.max(6, Math.round(fontPt * 1.1)),       // tick/arrow size
    color: t.color,
    strokeColor: t.color,
    measureUnit: t.unit,                                   // length unit
    startHead: 'openCircle',                               // standard ticks
    endHead: 'openCircle',
  };
}
