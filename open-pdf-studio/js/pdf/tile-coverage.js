import { viewportZichtbaar } from './weergave-rotatie.js';

const SCALE_EPSILON = 0.001;
const BOUNDS_EPSILON_PT = 0.5;

// Start de volgende tegel als het zicht dichter dan dit deel van zijn eigen
// maat bij een rand van de huidige tegel komt.
export const NEIGHBOR_EDGE_MARGIN = 0.35;

function coversRequest(meta, request, epsilon) {
  return Number.isFinite(meta.renderScale)
    && meta.renderScale + SCALE_EPSILON >= request.requiredScale
    && meta.regionXpt <= request.regionXpt + epsilon
    && meta.regionYpt <= request.regionYpt + epsilon
    && meta.regionXpt + meta.regionWpt
      >= request.regionXpt + request.regionWpt - epsilon
    && meta.regionYpt + meta.regionHpt
      >= request.regionYpt + request.regionHpt - epsilon;
}

/**
 * Return the cheapest cached tile that is already sharp enough and fully
 * covers the requested PDF-point viewport.
 */
export function findBestCoveringTile(entries, request, epsilon = BOUNDS_EPSILON_PT) {
  const candidates = entries.filter((entry) =>
    entry?.regionMeta && coversRequest(entry.regionMeta, request, epsilon));

  candidates.sort((a, b) => {
    const scaleDifference = a.regionMeta.renderScale - b.regionMeta.renderScale;
    if (Math.abs(scaleDifference) > SCALE_EPSILON) return scaleDifference;

    const aArea = a.regionMeta.regionWpt * a.regionMeta.regionHpt;
    const bArea = b.regionMeta.regionWpt * b.regionMeta.regionHpt;
    return aArea - bArea;
  });

  return candidates[0] || null;
}

// Het zichtbare deel van de pagina in PDF-punten van de paginaruimte (waar de
// tegels in staan). Houdt rekening met de paginarotatie (`rotation`, pageW/pageH
// zijn de maat daarvóór) en de weergaverotatie (`viewRotation`, #200): het
// scherm toont de pagina gedraaid, de tegels blijven ongedraaid.
export function visiblePdfRegion(viewport, cssWidth, cssHeight) {
  const zicht = viewportZichtbaar(viewport, cssWidth, cssHeight);
  return { x: zicht.x, y: zicht.y, w: zicht.width, h: zicht.height };
}

export function tileCoversViewport(
  tileMeta,
  viewport,
  cssWidth,
  cssHeight,
  devicePixelRatio,
) {
  if (!tileMeta) return false;
  const region = visiblePdfRegion(viewport, cssWidth, cssHeight);
  return findBestCoveringTile([{ regionMeta: tileMeta }], {
    regionXpt: region.x,
    regionYpt: region.y,
    regionWpt: region.w,
    regionHpt: region.h,
    requiredScale: viewport.zoom * devicePixelRatio,
  }) !== null;
}

function sideGap(name, tile, visible) {
  switch (name) {
    case 'left': return visible.x - tile.x;
    case 'right': return (tile.x + tile.w) - (visible.x + visible.w);
    case 'top': return visible.y - tile.y;
    case 'bottom': return (tile.y + tile.h) - (visible.y + visible.h);
    default: return Infinity;
  }
}

/**
 * De tegel naast het zicht, één zichtmaat opgeschoven naar de dichtstbijzijnde
 * rand. Null zolang het zicht ruim binnen de tegel ligt, of als de pagina de
 * verschuiving terug op dezelfde oorsprong klemt.
 * `tile` en `visible` zijn { x, y, w, h } in paginapunten; `page` is { w, h }.
 */
export function neighborTileRegion(tile, visible, page, margin = NEIGHBOR_EDGE_MARGIN) {
  if (!tile || !visible || !page) return null;
  if (!(tile.w > 0) || !(tile.h > 0) || !(visible.w > 0) || !(visible.h > 0)) return null;
  if (!(page.w > 0) || !(page.h > 0)) return null;

  const marginX = visible.w * margin;
  const marginY = visible.h * margin;
  const sides = [
    { name: 'left', axis: 'x', sign: -1, limit: marginX },
    { name: 'right', axis: 'x', sign: 1, limit: marginX },
    { name: 'top', axis: 'y', sign: -1, limit: marginY },
    { name: 'bottom', axis: 'y', sign: 1, limit: marginY },
  ];
  let near = null;
  for (const side of sides) {
    const gap = sideGap(side.name, tile, visible);
    if (gap < -BOUNDS_EPSILON_PT || gap >= side.limit) continue;
    if (!near || gap < near.gap) near = { ...side, gap };
  }
  if (!near) return null;

  const w = Math.min(tile.w, page.w);
  const h = Math.min(tile.h, page.h);
  let x = tile.x;
  let y = tile.y;
  if (near.axis === 'x') x += near.sign * visible.w;
  else y += near.sign * visible.h;
  x = Math.max(0, Math.min(page.w - w, x));
  y = Math.max(0, Math.min(page.h - h, y));
  if (Math.abs(x - tile.x) < BOUNDS_EPSILON_PT && Math.abs(y - tile.y) < BOUNDS_EPSILON_PT) return null;
  return { x, y, w, h };
}
