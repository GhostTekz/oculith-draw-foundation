// Where the floating thumbnail tile opens, and what it remembers.
//
// Every rectangle here is in physical screen pixels, the unit the native
// window reports for monitors and window geometry. Sizes in the defaults are
// CSS pixels and are multiplied by the monitor's scale factor.

export const TILE_MEMORY_KEY = 'oculithDraw.thumbnailTile.v1';

export const TILE_DEFAULTS = Object.freeze({
  width: 300,          // CSS px
  minWidth: 220,
  minHeight: 320,
  heightFraction: 0.6, // of the monitor's work area
  edgeGap: 24,         // from the drawing window's right edge
  topGap: 96,          // below the drawing window's title bar and ribbon
});

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const rectOk = (rect) => !!rect && finite(rect.x) && finite(rect.y)
  && finite(rect.width) && finite(rect.height) && rect.width > 0 && rect.height > 0;

/**
 * One usable area per monitor from the native monitor list. The work area
 * (without task bar or dock) is preferred over the full monitor.
 */
export function monitorAreas(monitors) {
  if (!Array.isArray(monitors)) return [];
  return monitors.map((monitor) => {
    const area = monitor?.workArea?.size?.width > 0 ? monitor.workArea : monitor;
    return {
      name: typeof monitor?.name === 'string' ? monitor.name : '',
      x: area?.position?.x, y: area?.position?.y,
      width: area?.size?.width, height: area?.size?.height,
      scale: finite(monitor?.scaleFactor) && monitor.scaleFactor > 0 ? monitor.scaleFactor : 1,
    };
  }).filter(rectOk);
}

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The area that holds most of `rect` (null when it is on none of them). */
export function areaFor(rect, areas) {
  let best = null;
  let most = 0;
  for (const area of areas) {
    const shared = overlap(rect, area);
    if (shared > most) { most = shared; best = area; }
  }
  return best;
}

/** Fit `rect` inside `area`: shrink to the area, then move fully onto it. */
export function clampToArea(rect, area, minWidth = 1, minHeight = 1) {
  const width = Math.round(Math.max(Math.min(minWidth, area.width), Math.min(rect.width, area.width)));
  const height = Math.round(Math.max(Math.min(minHeight, area.height), Math.min(rect.height, area.height)));
  const x = Math.round(Math.min(Math.max(rect.x, area.x), area.x + area.width - width));
  const y = Math.round(Math.min(Math.max(rect.y, area.y), area.y + area.height - height));
  return { x, y, width, height };
}

/** A remembered tile, or null when the stored value is not one. */
export function parseTileMemory(value) {
  let data = value;
  if (typeof value === 'string') {
    try { data = JSON.parse(value); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || !rectOk(data)) return null;
  const monitor = data.monitor && typeof data.monitor === 'object' && rectOk(data.monitor)
    ? { name: typeof data.monitor.name === 'string' ? data.monitor.name : '',
      x: data.monitor.x, y: data.monitor.y, width: data.monitor.width, height: data.monitor.height,
      scale: finite(data.monitor.scale) && data.monitor.scale > 0 ? data.monitor.scale : 1 }
    : null;
  return { x: data.x, y: data.y, width: data.width, height: data.height, monitor };
}

/** What the tile stores after it was moved or resized. */
export function tileMemory(rect, monitor) {
  if (!rectOk(rect)) return null;
  const area = monitor && rectOk(monitor) ? monitor : null;
  return {
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
    monitor: area ? { name: area.name || '', x: area.x, y: area.y,
      width: area.width, height: area.height, scale: area.scale || 1 } : null,
  };
}

/** The default tile: a narrow column at the drawing window's right edge. */
export function defaultTileRect(owner, areas, options = TILE_DEFAULTS) {
  const area = (rectOk(owner) && areaFor(owner, areas)) || areas[0] || null;
  const scale = area?.scale || 1;
  const width = Math.round(options.width * scale);
  const minHeight = options.minHeight * scale;
  const tall = area ? area.height * options.heightFraction : 680 * scale;
  const height = Math.round(Math.max(minHeight, Math.min(tall, area ? area.height : tall)));
  const base = rectOk(owner) ? owner : area || { x: 0, y: 0, width: width * 4, height };
  const rect = {
    x: base.x + base.width - width - options.edgeGap * scale,
    y: base.y + Math.min(options.topGap * scale, Math.max(0, base.height - height)),
    width, height,
  };
  return area ? clampToArea(rect, area, options.minWidth * scale, minHeight) : rect;
}

/**
 * Where to open the tile. A remembered tile returns to its own monitor, found
 * by name first (the arrangement may have moved it) and then by position. A
 * monitor that is no longer connected sends it back beside the drawing window.
 *
 * @returns {{ x, y, width, height, scale: number, restored: boolean }}
 */
export function tilePlacement({ memory, monitors, owner, options = TILE_DEFAULTS }) {
  const areas = monitorAreas(monitors);
  const saved = parseTileMemory(memory);
  if (saved && areas.length) {
    const named = saved.monitor?.name
      ? areas.filter((area) => area.name === saved.monitor.name) : [];
    let area = named.length === 1 ? named[0] : null;
    let rect = saved;
    if (area && saved.monitor) {
      // Keep the tile at the same spot on that monitor, wherever it now sits
      // in the desktop arrangement, at that monitor's current scale.
      const ratio = area.scale / (saved.monitor.scale || 1);
      rect = {
        x: area.x + (saved.x - saved.monitor.x) * ratio,
        y: area.y + (saved.y - saved.monitor.y) * ratio,
        width: saved.width * ratio, height: saved.height * ratio,
      };
    } else if (!named.length) {
      area = areaFor(saved, areas);
    }
    if (area) {
      const placed = clampToArea(rect, area, options.minWidth * area.scale, options.minHeight * area.scale);
      return { ...placed, scale: area.scale, restored: true };
    }
  }
  const area = (rectOk(owner) && areaFor(owner, areas)) || areas[0];
  return { ...defaultTileRect(owner, areas, options), scale: area?.scale || 1, restored: false };
}
