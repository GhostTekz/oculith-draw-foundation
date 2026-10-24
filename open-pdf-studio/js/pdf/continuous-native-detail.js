// A continuous page keeps a capped full-page bitmap for fast scrolling.
// At high zoom, render only the visible part at device-pixel resolution.
// Leave room below the worker's 64 MiB shared-memory ceiling (RGBA + header).
export const DETAIL_MAX_AXIS_PX = 4000;

export function detailTileRequest({ page, view, scale, dpr, maxAxis = DETAIL_MAX_AXIS_PX }) {
  if (!(page?.w > 0 && page?.h > 0 && view?.w > 0 && view?.h > 0 && scale > 0 && dpr > 0)) return null;
  const cssCap = maxAxis / dpr;
  const w = Math.min(page.w, cssCap, view.w * 1.35);
  const h = Math.min(page.h, cssCap, view.h * 1.35);
  const x = Math.max(0, Math.min(page.w - w, view.x + view.w / 2 - w / 2));
  const y = Math.max(0, Math.min(page.h - h, view.y + view.h / 2 - h / 2));
  return {
    css: { x, y, w, h },
    points: { x: x / scale, y: y / scale, w: w / scale, h: h / scale },
    renderScale: scale * dpr,
  };
}

export function detailTileCovers(tile, view, margin = 2) {
  return !!tile && !!view
    && tile.x <= view.x + margin && tile.y <= view.y + margin
    && tile.x + tile.w >= view.x + view.w - margin
    && tile.y + tile.h >= view.y + view.h - margin;
}
