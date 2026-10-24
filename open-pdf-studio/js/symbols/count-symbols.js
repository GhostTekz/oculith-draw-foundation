// Count symbols: the glyphs a count markup (the external editor Count tool) can show instead
// of the numbered dot. Each symbol is a canvas draw function
//   draw(ctx, { width, height, color }, params)
// that paints inside the box (0, 0)-(width, height) of the current transform.
// The same function draws the screen marker (annotations/count-marker.js on
// the real canvas) and the saved vector appearance (pdf/saver/
// canvas-pdf-recorder.js), so the two cannot drift apart. Draw functions may
// use only the recorder's subset of the 2D context API (paths, arcs,
// ellipses, rects, fill/stroke, transforms, dash, colours, Helvetica text).
//
// Other symbol modules can add glyphs with registerCountSymbol(); ids are
// stable because the saved PDF stores them (/OPS_SymbolId).

const WHITE = '#ffffff';

// Work in a 24-unit design square centred on the box.
function design(ctx, box, paint) {
  const s = Math.min(box.width, box.height);
  ctx.save();
  ctx.translate(box.width / 2, box.height / 2);
  ctx.scale(s / 24, s / 24);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  paint(box.color || '#e11d48');
  ctx.restore();
}

function polygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

function star(ctx, outer, inner, n = 5) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  polygon(ctx, pts);
}

const fillOutline = (ctx, col, w = 1.5) => {
  ctx.fillStyle = col; ctx.fill();
  ctx.strokeStyle = WHITE; ctx.lineWidth = w; ctx.stroke();
};
const outline = (ctx, col, w = 2) => {
  ctx.fillStyle = WHITE; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
};

const BUILT_IN = [
  { id: 'count.circle', label: 'Cirkel', labelEn: 'Circle',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); fillOutline(ctx, col, 2);
    }) },
  { id: 'count.ring', label: 'Ring', labelEn: 'Ring',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); outline(ctx, col, 3);
    }) },
  { id: 'count.square', label: 'Vierkant', labelEn: 'Square',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.rect(-9, -9, 18, 18); fillOutline(ctx, col, 2);
    }) },
  { id: 'count.triangle', label: 'Driehoek', labelEn: 'Triangle',
    draw: (ctx, box) => design(ctx, box, (col) => {
      polygon(ctx, [[0, -10.5], [10.5, 8.5], [-10.5, 8.5]]); ctx.lineJoin = 'round'; fillOutline(ctx, col, 2);
    }) },
  { id: 'count.diamond', label: 'Ruit', labelEn: 'Diamond',
    draw: (ctx, box) => design(ctx, box, (col) => {
      polygon(ctx, [[0, -11], [11, 0], [0, 11], [-11, 0]]); fillOutline(ctx, col, 2);
    }) },
  { id: 'count.star', label: 'Ster', labelEn: 'Star',
    draw: (ctx, box) => design(ctx, box, (col) => {
      star(ctx, 11.5, 5); ctx.lineJoin = 'round'; fillOutline(ctx, col, 1.5);
    }) },
  { id: 'count.hexagon', label: 'Zeshoek', labelEn: 'Hexagon',
    draw: (ctx, box) => design(ctx, box, (col) => {
      const pts = [];
      for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; pts.push([10 * Math.cos(a), 10 * Math.sin(a)]); }
      polygon(ctx, pts); outline(ctx, col, 2.5);
    }) },
  { id: 'count.cross', label: 'Kruis', labelEn: 'Cross',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath();
      ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8);
      ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.stroke();
    }) },
  { id: 'count.plus', label: 'Plus', labelEn: 'Plus',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath();
      ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
      ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'square'; ctx.stroke();
    }) },
  { id: 'count.check', label: 'Vinkje', labelEn: 'Check',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.moveTo(-9, 0.5); ctx.lineTo(-3, 7); ctx.lineTo(9.5, -7.5);
      ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    }) },
  { id: 'count.pin', label: 'Speld', labelEn: 'Pin',
    draw: (ctx, box) => design(ctx, box, (col) => {
      // Teardrop with a hole: Béziers, a quadratic tip and an even-odd fill.
      ctx.beginPath();
      ctx.moveTo(0, 11.5);
      ctx.quadraticCurveTo(-3, 5, -6.5, 0.5);
      ctx.bezierCurveTo(-10.5, -4.5, -6.5, -11.5, 0, -11.5);
      ctx.bezierCurveTo(6.5, -11.5, 10.5, -4.5, 6.5, 0.5);
      ctx.quadraticCurveTo(3, 5, 0, 11.5);
      ctx.closePath();
      ctx.moveTo(3.2, -4.5);
      ctx.arc(0, -4.5, 3.2, Math.PI * 2, 0, true);
      ctx.fillStyle = col; ctx.fill('evenodd');
    }) },
  { id: 'count.receptacle', label: 'Wandcontactdoos', labelEn: 'Receptacle',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, Math.PI * 2); outline(ctx, col, 2);
      ctx.beginPath();
      ctx.moveTo(-3, -11); ctx.lineTo(-3, 11); ctx.moveTo(3, -11); ctx.lineTo(3, 11);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }) },
  { id: 'count.light', label: 'Lichtpunt', labelEn: 'Light fixture',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 10, 0, 0, Math.PI * 2); outline(ctx, col, 2);
      ctx.save();
      ctx.rotate(Math.PI / 4);
      ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.moveTo(0, -10); ctx.lineTo(0, 10);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }) },
  { id: 'count.switch', label: 'Schakelaar', labelEn: 'Switch',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); outline(ctx, col, 2);
      ctx.fillStyle = col; ctx.font = 'bold 15px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('S', 0, 5.4);
    }) },
  { id: 'count.smoke', label: 'Rookmelder', labelEn: 'Smoke detector',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); outline(ctx, col, 2);
      ctx.fillStyle = col; ctx.font = 'bold 9px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('SD', 0, 3.3);
    }) },
  { id: 'count.sprinkler', label: 'Sprinkler', labelEn: 'Sprinkler',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = WHITE; ctx.fill();
      ctx.setLineDash([3.5, 2.5]); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    }) },
  { id: 'count.tag', label: 'Label', labelEn: 'Tag',
    draw: (ctx, box) => design(ctx, box, (col) => {
      ctx.beginPath(); ctx.ellipse(0, 0, 11.5, 6.5, -Math.PI / 8, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }) },
];

const symbols = new Map(BUILT_IN.map(s => [s.id, Object.freeze(s)]));

/** The count symbol with this id, or null. */
export function getCountSymbol(id) {
  return typeof id === 'string' ? symbols.get(id) || null : null;
}

/** Every count symbol, built-in first, in palette order. */
export function listCountSymbols() {
  return [...symbols.values()];
}

/**
 * Add a count symbol from another module (e.g. a construction symbol set).
 * `draw` must stay within the canvas-to-PDF recorder subset; anything else
 * throws when the count is saved and the count falls back to the dot.
 */
export function registerCountSymbol(def) {
  if (!def || typeof def.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(def.id) ||
      typeof def.draw !== 'function') return false;
  symbols.set(def.id, Object.freeze({ label: def.id, labelEn: def.id, ...def }));
  return true;
}

export const BUILT_IN_COUNT_SYMBOL_IDS = Object.freeze(BUILT_IN.map(s => s.id));
