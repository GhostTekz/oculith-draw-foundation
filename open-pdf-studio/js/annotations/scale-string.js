// A scale region's scale string ("1:100") and what it means in PDF units.
// Pure: used by the scale regions (scale-region.js) and by the reading of
// /VP viewports (pdf/viewports-vp.js), also in the pdf-lib worker.

// Parse "1:100" → 100 (the denominator of the drawing-to-world ratio)
export function parseScaleString(s) {
  if (!s) return null;
  const m = String(s).match(/^\s*1\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const denom = parseFloat(m[1]);
  if (!Number.isFinite(denom) || denom <= 0) return null;
  return denom;
}

// Compute pixelsPerUnit for a scale region given its scaleString + units.
// PDF user units = 1/72 inch. We keep this consistent with the viewport tool:
//   1 mm at 1:N maps to (72 / 25.4) / N pixels.
//   1 cm = 10mm; 1 m = 1000mm; 1 in = 25.4mm; 1 ft = 304.8mm.
export function pixelsPerUnitFor(scaleString, units) {
  const denom = parseScaleString(scaleString);
  if (!denom || !['mm', 'cm', 'm', 'in', 'ft'].includes(units)) return null;
  const ppmm = (72 / 25.4) / denom;
  if (!Number.isFinite(ppmm) || ppmm <= 0) return null;
  let pixelsPerUnit;
  switch (units) {
    case 'mm': pixelsPerUnit = ppmm; break;
    case 'cm': pixelsPerUnit = ppmm * 10; break;
    case 'm':  pixelsPerUnit = ppmm * 1000; break;
    case 'in': pixelsPerUnit = ppmm * 25.4; break;
    case 'ft': pixelsPerUnit = ppmm * 304.8; break;
    default:   return null;
  }
  return Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? pixelsPerUnit : null;
}
