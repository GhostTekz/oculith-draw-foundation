// Parametric peilmaat (spot elevation) — open triangle marker with a level
// value, Dutch drafting convention. The triangle tip marks the measured
// point (bottom-centre of the bounding box); the value reads above the line.
export const peilmaatTemplate = {
  id: 'peilmaat',
  name: 'Peilmaat',
  nameEn: 'Spot elevation',
  category: 'NL',
  defaultSize: { width: 120, height: 48 },
  params: [
    { key: 'value', label: 'Waarde', labelEn: 'Value', type: 'string', default: 'P = 0' },
    { key: 'filled', label: 'Gevuld driehoekje', labelEn: 'Filled triangle', type: 'boolean', default: false },
    { key: 'baseline', label: 'Basislijn', labelEn: 'Baseline', type: 'boolean', default: true },
  ],
  render(params, bbox) {
    const cmds = [];
    const { x, y, width: w, height: h } = bbox;
    const value = String(params.value ?? 'P = 0');
    const cx = x + w / 2;
    const tipY = y + h;            // measured point
    const triH = Math.min(h * 0.45, 18);
    const triW = triH * 1.15;
    const topY = tipY - triH;

    // Open (or filled) triangle, tip down on the measured point.
    cmds.push({
      kind: 'polyline',
      points: [
        { x: cx, y: tipY },
        { x: cx - triW / 2, y: topY },
        { x: cx + triW / 2, y: topY },
        { x: cx, y: tipY },
      ],
      close: true,
      fill: !!params.filled,
    });

    // Baseline through the triangle top, extending across the symbol width.
    if (params.baseline !== false) {
      cmds.push({ kind: 'line', x1: x, y1: topY, x2: x + w, y2: topY });
    }

    // Value text above the baseline.
    const textSize = Math.min(Math.max(10, h * 0.34), 16);
    cmds.push({ kind: 'text', x: cx, y: topY - textSize * 0.75, text: value, size: textSize });

    return cmds;
  }
};
