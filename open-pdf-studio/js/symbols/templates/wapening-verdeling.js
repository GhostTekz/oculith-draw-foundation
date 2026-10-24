// Parametric rebar distribution callout (wapening-verdeling) — a horizontal
// reference line with N hooked legs ending in bar dots (bars in section),
// labelled "n Ø d" (e.g. "3 Ø 12"). Count and diameter are parameters.
export const wapeningVerdelingTemplate = {
  id: 'wapeningVerdeling',
  name: 'Wapening verdeling',
  nameEn: 'Rebar distribution',
  category: 'NL',
  defaultSize: { width: 220, height: 70 },
  params: [
    { key: 'aantal', label: 'Aantal', labelEn: 'Count', type: 'number', default: 3, min: 1, max: 30, step: 1 },
    { key: 'diameter', label: 'Diameter (mm)', labelEn: 'Diameter (mm)', type: 'number', default: 12, min: 4, max: 50, step: 1 },
  ],
  _layout(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const n = Math.max(1, Math.round(Number(params.aantal) || 3));
    // Label takes the right ~35% of the box; the reference line the rest.
    const labelW = Math.min(w * 0.4, 90);
    const lineY = y + h * 0.25;
    const lineX1 = x;
    const lineX2 = x + w - labelW;
    const dotY = y + h * 0.85;
    const dotR = Math.max(2, Math.min(5, h * 0.06));
    // Legs hang from evenly spaced points, slanting back to the left.
    const slant = Math.min((dotY - lineY) * 0.6, 28);
    const span = Math.max(10, lineX2 - lineX1 - slant - 8);
    const step = n > 1 ? span / n : 0;
    const legs = [];
    for (let i = 0; i < n; i++) {
      const topX = lineX1 + slant + 8 + step * (i + 0.5);
      legs.push({ x1: topX, y1: lineY, x2: topX - slant, y2: dotY });
    }
    return { lineY, lineX1, lineX2, legs, dotR, labelX: x + w - labelW / 2, labelY: lineY };
  },
  render(params, bbox) {
    const cmds = [];
    const L = this._layout(params, bbox);
    const n = Math.max(1, Math.round(Number(params.aantal) || 3));
    const d = Math.round(Number(params.diameter) || 12);

    cmds.push({ kind: 'line', x1: L.lineX1, y1: L.lineY, x2: L.lineX2, y2: L.lineY });
    for (const leg of L.legs) {
      cmds.push({ kind: 'line', x1: leg.x1, y1: leg.y1, x2: leg.x2, y2: leg.y2 });
      // Bar in section: filled dot at the leg end.
      cmds.push({
        kind: 'polyline', fill: true, close: true,
        points: _dotPoints(leg.x2, leg.y2, L.dotR),
      });
    }
    const size = Math.max(10, Math.min(22, bbox.height * 0.35));
    cmds.push({ kind: 'text', x: L.labelX, y: L.labelY, text: `${n} Ø ${d}`, size });
    return cmds;
  },
  snapPoints(params, bbox) {
    const L = this._layout(params, bbox);
    const pts = [
      { x: L.lineX1, y: L.lineY, kind: 'endpoint' },
      { x: L.lineX2, y: L.lineY, kind: 'endpoint' },
    ];
    for (const leg of L.legs) pts.push({ x: leg.x2, y: leg.y2, kind: 'center' });
    return pts;
  },
};

// Approximate a small filled circle as a polygon (the command walker has no
// filled-circle primitive; 10 segments is visually round at dot sizes).
function _dotPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}
