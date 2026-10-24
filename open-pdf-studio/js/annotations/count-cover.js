// Ask the desktop geometry engine once whether a stored count lies in the
// space JavaScript already picked. A missing command keeps point-in-polygon.
// Snap, hit testing, and raceway strokes stay in JavaScript.

import { getActiveDocument } from '../core/state.js';
import { collectSpaces, markupAnchor, spaceAt } from '../spaces/model.js';

function ringOf(points) {
  const ring = [];
  for (const point of points || []) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
  }
  return ring;
}

function clearOutside(annotation) {
  if (annotation.engineOutsideSpace === undefined) return false;
  delete annotation.engineOutsideSpace;
  return true;
}

/**
 * Compare one stored count with `geos_covers` on the space `spaceAt` already
 * chose. Returns true only when the outside flag is set or cleared.
 * `invoke` is the desktop command caller.
 */
export async function confirmCountCover(annotation, doc, invoke) {
  if (annotation?.type !== 'count' || typeof invoke !== 'function') return false;
  const point = markupAnchor(annotation);
  const page = Number(annotation.page) || 1;
  const jsSpace = spaceAt(collectSpaces(doc), page, point);
  if (!jsSpace) return clearOutside(annotation);
  let covered;
  try {
    covered = await invoke('geos_covers', { ring: ringOf(jsSpace.points), x: point.x, y: point.y });
  } catch {
    return false;
  }
  if (typeof covered !== 'boolean') return false;
  if (covered) return clearOutside(annotation);
  annotation.engineOutsideSpace = true;
  return true;
}

function publish(changed) {
  if (!changed.some(Boolean)) return undefined;
  void import('./geometry-revision.js').then((mod) => mod.noteGeometry()).catch(() => {});
  return import('./rendering.js').then((mod) => mod.redrawAnnotations());
}

/** Ask once for each stored count. No desktop command leaves every flag alone. */
export function scheduleCountCover(annotations) {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') return;
  const list = (Array.isArray(annotations) ? annotations : [annotations])
    .filter((annotation) => annotation?.type === 'count');
  if (list.length === 0) return;
  const doc = getActiveDocument();
  void Promise.all(list.map((annotation) => confirmCountCover(annotation, doc, invoke)))
    .then(publish)
    .catch(() => {});
}
