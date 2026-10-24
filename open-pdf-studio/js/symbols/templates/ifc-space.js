// IfcSpace — a named space/zone region (plattegrond). Drag-to-size (NOT
// fixed-size): the boundary is a dashed rectangle with the space name (and
// optional number) centred, the usual convention for room zoning overlays.
export const ifcSpaceTemplate = {
  id: 'ifc-space',
  name: 'IfcSpace',
  nameEn: 'IfcSpace',
  category: 'IFC',
  defaultSize: { width: 160, height: 120 },
  params: [
    { key: 'naam', label: 'Naam', labelEn: 'Name', type: 'string', default: 'Ruimte' },
    { key: 'nummer', label: 'Nummer', labelEn: 'Number', type: 'string', default: '' },
    { key: 'rand', label: 'Rand tonen', labelEn: 'Show boundary', type: 'boolean', default: true },
  ],
  snapPoints(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    return [
      { kind: 'center', x: x + w / 2, y: y + h / 2 },
      { kind: 'endpoint', x, y }, { kind: 'endpoint', x: x + w, y },
      { kind: 'endpoint', x, y: y + h }, { kind: 'endpoint', x: x + w, y: y + h },
    ];
  },
  render(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const cmds = [];
    if (params?.rand !== false) {
      const dash = Math.max(3, Math.min(10, w * 0.04));
      cmds.push({
        kind: 'polyline',
        points: [
          { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
        ],
        close: true,
        dash: [dash, dash * 0.6],
      });
    }
    const naam = String(params?.naam ?? 'Ruimte');
    const nummer = String(params?.nummer ?? '');
    const size = Math.max(9, Math.min(16, h * 0.16));
    const cx = x + w / 2, cy = y + h / 2;
    if (nummer) {
      cmds.push({ kind: 'text', x: cx, y: cy - size * 0.7, text: nummer, size, bold: true });
      cmds.push({ kind: 'text', x: cx, y: cy + size * 0.7, text: naam, size });
    } else {
      cmds.push({ kind: 'text', x: cx, y: cy, text: naam, size });
    }
    return cmds;
  },
};
