// Parametric stirrup callout (beugels) — a section rectangle with the
// double-line stirrup detail at the top-right, labelled
// "bgls Ø{d} - {afstand}" (e.g. "bgls Ø8 - 250"). Diameter and spacing
// (hart-op-hart) are parameters; the prefix text is editable too.
export const beugelTemplate = {
  id: 'beugel',
  name: 'Beugels',
  nameEn: 'Stirrups',
  category: 'NL',
  defaultSize: { width: 300, height: 160 },
  params: [
    { key: 'diameter', label: 'Diameter (mm)', labelEn: 'Diameter (mm)', type: 'number', default: 8, min: 4, max: 25, step: 1 },
    { key: 'afstand', label: 'Afstand h.o.h. (mm)', labelEn: 'Spacing (mm)', type: 'number', default: 250, min: 25, max: 1000, step: 25 },
    { key: 'prefix', label: 'Voorvoegsel', labelEn: 'Prefix', type: 'string', default: 'bgls' },
    { key: 'kader', label: 'Doorsnede-kader', labelEn: 'Section outline', type: 'boolean', default: true },
  ],
  _layout(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    // Section rectangle on the left (~55% of the width), label to the right.
    const rw = Math.min(w * 0.55, h * 0.8);
    const rect = { x, y, w: rw, h };
    const off = Math.max(3, Math.min(7, rw * 0.04)); // stirrup double-line offset
    return {
      rect, off,
      labelX: x + rw + (w - rw) / 2,
      labelY: y + h * 0.55,
    };
  },
  render(params, bbox) {
    const cmds = [];
    const L = this._layout(params, bbox);
    const { rect: r, off } = L;
    const d = Math.round(Number(params.diameter) || 8);
    const s = Math.round(Number(params.afstand) || 250);
    const prefix = String(params.prefix ?? 'bgls');

    if (params.kader !== false) {
      cmds.push({
        kind: 'polyline', close: true,
        points: [
          { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
          { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
          { x: r.x, y: r.y },
        ],
      });
    }
    // Stirrup detail: a second line just inside the top edge (right half) and
    // just inside the right edge (top third) — the double-line look from the
    // drafting convention.
    cmds.push({ kind: 'line', x1: r.x + r.w * 0.45, y1: r.y + off, x2: r.x + r.w - off, y2: r.y + off });
    cmds.push({ kind: 'line', x1: r.x + r.w - off, y1: r.y + off, x2: r.x + r.w - off, y2: r.y + r.h * 0.4 });

    const size = Math.max(10, Math.min(22, bbox.height * 0.18));
    cmds.push({ kind: 'text', x: L.labelX, y: L.labelY, text: `${prefix} Ø${d} - ${s}`, size });
    return cmds;
  },
  snapPoints(params, bbox) {
    const { rect: r } = this._layout(params, bbox);
    return [
      { x: r.x, y: r.y, kind: 'endpoint' },
      { x: r.x + r.w, y: r.y, kind: 'endpoint' },
      { x: r.x, y: r.y + r.h, kind: 'endpoint' },
      { x: r.x + r.w, y: r.y + r.h, kind: 'endpoint' },
      { x: r.x + r.w / 2, y: r.y + r.h / 2, kind: 'center' },
    ];
  },
};
