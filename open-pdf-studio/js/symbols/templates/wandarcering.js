// Parametric wall-hatch element (lijn-arcering) — a linear element whose
// body is filled with section hatching at the conventional 60°, with the
// element thickness as a parameter. Drawn along the long axis of the
// bounding box; the hatch is clipped to the element rectangle analytically
// (the command walker has no clip support, so we intersect each hatch line
// with the rect ourselves).
export const wandarceringTemplate = {
  id: 'wandarcering',
  name: 'Arcering (lijn)',
  nameEn: 'Wall hatch (linear)',
  category: 'NL',
  defaultSize: { width: 260, height: 18 },
  params: [
    { key: 'dikte', label: 'Dikte', labelEn: 'Thickness', type: 'number', default: 18, min: 2, max: 400, step: 1, unit: 'pt' },
    { key: 'hoek', label: 'Arceerhoek (°)', labelEn: 'Hatch angle (°)', type: 'number', default: 60, min: 15, max: 165, step: 5, unit: '°' },
    { key: 'afstand', label: 'Arceerafstand', labelEn: 'Hatch spacing', type: 'number', default: 7, min: 2, max: 60, step: 1, unit: 'pt' },
    { key: 'rand', label: 'Randlijnen', labelEn: 'Outline', type: 'boolean', default: true },
  ],
  render(params, bbox) {
    const cmds = [];
    const { x, y, width: w, height: h } = bbox;
    const horizontal = w >= h;

    // Element rect: full length along the long axis; thickness (clamped to
    // the bbox) centred on the cross axis.
    const tRaw = Number(params.dikte) || 18;
    const t = Math.max(2, Math.min(tRaw, horizontal ? h : w));
    let rx, ry, rw, rh;
    if (horizontal) {
      rx = x; rw = w;
      ry = y + (h - t) / 2; rh = t;
    } else {
      ry = y; rh = h;
      rx = x + (w - t) / 2; rw = t;
    }

    // Outline: the two long edges (classic wall lines), not the short ends.
    if (params.rand !== false) {
      if (horizontal) {
        cmds.push({ kind: 'line', x1: rx, y1: ry, x2: rx + rw, y2: ry });
        cmds.push({ kind: 'line', x1: rx, y1: ry + rh, x2: rx + rw, y2: ry + rh });
      } else {
        cmds.push({ kind: 'line', x1: rx, y1: ry, x2: rx, y2: ry + rh });
        cmds.push({ kind: 'line', x1: rx + rw, y1: ry, x2: rx + rw, y2: ry + rh });
      }
    }

    // Hatch lines at `hoek`°, spaced `afstand` apart, clipped to the rect.
    const angle = ((Number(params.hoek) || 60) * Math.PI) / 180;
    const dirX = Math.cos(angle);
    const dirY = -Math.sin(angle); // canvas y-down: 60° visually rising
    // Normal to the hatch direction (offset stepping axis)
    const nX = -dirY, nY = dirX;
    const spacing = Math.max(2, Number(params.afstand) || 7);

    // Project rect corners on the normal to find the offset range.
    const corners = [
      { x: rx, y: ry }, { x: rx + rw, y: ry },
      { x: rx, y: ry + rh }, { x: rx + rw, y: ry + rh },
    ];
    const offs = corners.map(c => c.x * nX + c.y * nY);
    const offMin = Math.min(...offs);
    const offMax = Math.max(...offs);

    for (let o = Math.ceil(offMin / spacing) * spacing; o <= offMax; o += spacing) {
      // Infinite line: P(t) = o*n + t*dir. Clip to rect via slab method.
      const px = o * nX, py = o * nY;
      let t0 = -Infinity, t1 = Infinity;
      // X slabs
      if (Math.abs(dirX) < 1e-9) {
        if (px < rx || px > rx + rw) continue;
      } else {
        const a = (rx - px) / dirX, b = (rx + rw - px) / dirX;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      // Y slabs
      if (Math.abs(dirY) < 1e-9) {
        if (py < ry || py > ry + rh) continue;
      } else {
        const a = (ry - py) / dirY, b = (ry + rh - py) / dirY;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      if (t1 <= t0) continue;
      cmds.push({
        kind: 'line',
        x1: px + dirX * t0, y1: py + dirY * t0,
        x2: px + dirX * t1, y2: py + dirY * t1,
      });
    }

    return cmds;
  },
  // Snap to the element's long-edge endpoints and midline ends.
  snapPoints(params, bbox) {
    const { x, y, width: w, height: h } = bbox;
    const horizontal = w >= h;
    const cx = x + w / 2, cy = y + h / 2;
    if (horizontal) {
      return [
        { x, y: cy, kind: 'endpoint' },
        { x: x + w, y: cy, kind: 'endpoint' },
        { x: cx, y: cy, kind: 'midpoint' },
      ];
    }
    return [
      { x: cx, y, kind: 'endpoint' },
      { x: cx, y: y + h, kind: 'endpoint' },
      { x: cx, y: cy, kind: 'midpoint' },
    ];
  }
};
