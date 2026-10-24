// Cut two committed paths at a real crossing. Two-point lines still meet by
// the infinite-line corner. A longer path keeps the segment crossing, then
// asks the desktop engine for the same point. A missing command leaves the
// segment cut. This does not run while the pointer is moving.

import { state, getActiveDocument } from '../core/state.js';
import { expandArcPoints, hasArcPoints } from './arc-points.js';

// Same corner as geometry.js. It stays here so a trim does not load the
// drawing tools, and so two straight lines keep the infinite-line meeting.
function lineLineIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}

function annotationsHolding(annotation) {
  const doc = (state.documents || []).find((item) => item?.annotations?.includes?.(annotation));
  return (doc || getActiveDocument())?.annotations || [];
}

function straight(points) {
  return hasArcPoints(points) ? expandArcPoints(points) : points;
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Open path stored on a line or a polyline, with arcs flattened. */
export function pathOf(annotation) {
  if (!annotation) return null;
  if (Array.isArray(annotation.points) && annotation.points.length >= 2) {
    const points = straight(annotation.points).filter(finitePoint);
    if (points.length >= 2) return points.map((point) => ({ x: point.x, y: point.y }));
  }
  if ([annotation.startX, annotation.startY, annotation.endX, annotation.endY].every(Number.isFinite)) {
    return [
      { x: annotation.startX, y: annotation.startY },
      { x: annotation.endX, y: annotation.endY },
    ];
  }
  return null;
}

function pairs(path) {
  return path.map((point) => [point.x, point.y]);
}

function fromPairs(pairsList) {
  return pairsList.map(([x, y]) => ({ x, y }));
}

function same(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6;
}

function dedupe(points) {
  const out = [];
  for (const point of points) {
    if (!out.length || !same(out[out.length - 1], point)) out.push({ x: point.x, y: point.y });
  }
  return out.length >= 2 ? out : null;
}

function segmentLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Where `point` sits along `path`, or the closest point of the path. */
function chainOf(path, point) {
  let best = null;
  let bestDistance = Infinity;
  let covered = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const length = segmentLength(start, end);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denom = dx * dx + dy * dy;
    let t = 0;
    if (denom > 0) {
      t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / denom;
      t = Math.min(1, Math.max(0, t));
    }
    const x = start.x + dx * t;
    const y = start.y + dy * t;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { index, t, along: covered + length * t };
    }
    covered += length;
  }
  return best;
}

/** Crossings that lie on both segments, not on the infinite lines. */
export function segmentCrossings(left, right) {
  const hits = [];
  for (let i = 0; i < left.length - 1; i += 1) {
    for (let j = 0; j < right.length - 1; j += 1) {
      const hit = lineLineIntersection(left[i], left[i + 1], right[j], right[j + 1]);
      if (!hit || hit.t < -1e-8 || hit.t > 1 + 1e-8 || hit.u < -1e-8 || hit.u > 1 + 1e-8) continue;
      const point = { x: hit.x, y: hit.y };
      if (!hits.some((other) => same(other, point))) hits.push(point);
    }
  }
  return hits;
}

export function nearestPoint(points, click) {
  let best = null;
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(point.x - click.x, point.y - click.y);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function pointAt(path, at) {
  const start = path[at.index];
  const end = path[at.index + 1];
  return {
    x: start.x + (end.x - start.x) * at.t,
    y: start.y + (end.y - start.y) * at.t,
  };
}

function pathLength(path) {
  let total = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    total += segmentLength(path[index], path[index + 1]);
  }
  return total;
}

function piecesAt(path, at, point) {
  const total = pathLength(path);
  const margin = Math.max(1e-6, total * 0.02);
  if (at.along <= margin || at.along >= total - margin) return null;
  const head = dedupe([...path.slice(0, at.index + 1), point]);
  const tail = dedupe([point, ...path.slice(at.index + 1)]);
  if (!head || !tail) return null;
  return { head, tail, point: { x: point.x, y: point.y } };
}

/** An open polyline or perimeter. A closed ring is not split into two pieces. */
export function openPathOf(annotation) {
  if (!annotation || (annotation.type !== 'polyline' && annotation.type !== 'measurePerimeter')) return null;
  const path = pathOf(annotation);
  if (!path || path.length < 3) return null;
  const first = path[0];
  const last = path[path.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) return null;
  return path;
}

/** Split an open path where the click falls on it. An endpoint click does nothing. */
export function splitAtPoint(path, click) {
  const at = chainOf(path, click);
  if (!at) return null;
  return piecesAt(path, at, pointAt(path, at));
}

/** Split an open path at the segment crossing nearest the click. */
export function splitAtCrossing(targetPath, cutterPath, click) {
  const hit = nearestPoint(segmentCrossings(targetPath, cutterPath), click);
  if (!hit) return null;
  const at = chainOf(targetPath, hit);
  if (!at) return null;
  return piecesAt(targetPath, at, hit);
}

/**
 * Keep the side of `path` that does not contain the click, and end it at
 * `crossing`. The endpoint nearest the click is the one that moves.
 */
export function cutToCrossing(path, click, crossing) {
  const at = chainOf(path, crossing);
  const near = chainOf(path, click);
  if (!at || !near) return null;
  if (near.along >= at.along) {
    return dedupe([...path.slice(0, at.index + 1), crossing]);
  }
  return dedupe([crossing, ...path.slice(at.index + 1)]);
}

function writePath(annotation, path) {
  if (Array.isArray(annotation.points)) {
    annotation.points = path.map((point) => ({ x: point.x, y: point.y }));
    return;
  }
  annotation.startX = path[0].x;
  annotation.startY = path[0].y;
  annotation.endX = path[path.length - 1].x;
  annotation.endY = path[path.length - 1].y;
}

function stamp(annotation) {
  annotation.modifiedAt = new Date().toISOString();
}

function moveEndpoint(annotation, path, which, point) {
  if (Array.isArray(annotation.points) && annotation.points.length >= 2) {
    const next = annotation.points.map((item) => ({ ...item }));
    const index = which === 'start' ? 0 : next.length - 1;
    next[index] = { ...next[index], x: point.x, y: point.y };
    annotation.points = next;
    return;
  }
  if (which === 'start') {
    annotation.startX = point.x;
    annotation.startY = point.y;
  } else {
    annotation.endX = point.x;
    annotation.endY = point.y;
  }
}

function nearerEnd(path, click) {
  const start = Math.hypot(click.x - path[0].x, click.y - path[0].y);
  const end = Math.hypot(click.x - path[path.length - 1].x, click.y - path[path.length - 1].y);
  return start < end ? 'start' : 'end';
}

/**
 * Trim `target` against `cutter` at `click`. Returns the undo snapshots, or
 * null when the paths do not meet. A longer path records `crossPending` so
 * the desktop engine can replace the segment crossing.
 */
export function trimPair(target, cutter, click) {
  const targetPath = pathOf(target);
  const cutterPath = pathOf(cutter);
  if (!targetPath || !cutterPath) return null;
  const oldTarget = JSON.parse(JSON.stringify(target));
  const oldCutter = JSON.parse(JSON.stringify(cutter));

  if (targetPath.length === 2 && cutterPath.length === 2) {
    const hit = lineLineIntersection(targetPath[0], targetPath[1], cutterPath[0], cutterPath[1]);
    if (!hit) return null;
    moveEndpoint(target, targetPath, nearerEnd(targetPath, click), hit);
    moveEndpoint(cutter, cutterPath, nearerEnd(cutterPath, click), hit);
    stamp(target);
    stamp(cutter);
    return { oldTarget, oldCutter };
  }

  const hit = nearestPoint(segmentCrossings(targetPath, cutterPath), click);
  if (!hit) return null;
  const nextTarget = cutToCrossing(targetPath, click, hit);
  const nextCutter = cutToCrossing(cutterPath, click, hit);
  if (!nextTarget || !nextCutter) return null;
  writePath(target, nextTarget);
  writePath(cutter, nextCutter);
  stamp(target);
  stamp(cutter);
  target.crossPending = {
    cutterId: cutter.id,
    targetPath: pairs(targetPath),
    cutterPath: pairs(cutterPath),
    x: click.x,
    y: click.y,
    jsPoint: [hit.x, hit.y],
  };
  return { oldTarget, oldCutter };
}

function clearPending(annotation) {
  if (annotation) delete annotation.crossPending;
}

/**
 * Replace a segment cut with the engine's crossing. The original paths are
 * on `crossPending`, so this can run again after redo.
 */
export async function refineCross(annotation, invoke) {
  const pending = annotation?.crossPending;
  if (!pending) return false;
  clearPending(annotation);
  try {
    const points = await invoke('geos_crossings', {
      a: pending.targetPath,
      b: pending.cutterPath,
    });
    if (!Array.isArray(points) || points.length === 0) return false;
    const hit = nearestPoint(points.map(([x, y]) => ({ x, y })), { x: pending.x, y: pending.y });
    if (!hit) return false;
    const js = pending.jsPoint;
    if (js && Math.hypot(hit.x - js[0], hit.y - js[1]) <= 1e-6) return false;
    const click = { x: pending.x, y: pending.y };
    const targetPath = fromPairs(pending.targetPath);
    const cutterPath = fromPairs(pending.cutterPath);
    const nextTarget = cutToCrossing(targetPath, click, hit);
    const nextCutter = cutToCrossing(cutterPath, click, hit);
    if (!nextTarget || !nextCutter) return false;
    writePath(annotation, nextTarget);
    const cutter = annotationsHolding(annotation).find((item) => item && item.id === pending.cutterId);
    if (cutter && cutter !== annotation) writePath(cutter, nextCutter);
    stamp(annotation);
    if (cutter) stamp(cutter);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move a polyline split onto the engine crossing. Both pieces were cut at
 * the segment crossing, and `splitPending` still has the original path.
 */
export async function refineSplit(annotation, invoke) {
  const pending = annotation?.splitPending;
  if (!pending) return false;
  delete annotation.splitPending;
  try {
    const points = await invoke('geos_crossings', {
      a: pending.targetPath,
      b: pending.cutterPath,
    });
    if (!Array.isArray(points) || points.length === 0) return false;
    const hit = nearestPoint(points.map(([x, y]) => ({ x, y })), { x: pending.x, y: pending.y });
    if (!hit) return false;
    const js = pending.jsPoint;
    if (js && Math.hypot(hit.x - js[0], hit.y - js[1]) <= 1e-6) return false;
    const original = fromPairs(pending.targetPath);
    const at = chainOf(original, hit);
    if (!at) return false;
    const parts = piecesAt(original, at, hit);
    if (!parts) return false;
    writePath(annotation, parts.head);
    const tail = annotationsHolding(annotation).find((item) => item && item.id === pending.tailId);
    if (tail) writePath(tail, parts.tail);
    stamp(annotation);
    if (tail) stamp(tail);
    return true;
  } catch {
    return false;
  }
}

/** Ask the desktop engine for each trim that still has a pending crossing. */
export function scheduleCrossRefine(annotations) {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  const list = (Array.isArray(annotations) ? annotations : [annotations]).filter((item) => item?.crossPending);
  if (typeof invoke !== 'function') {
    list.forEach(clearPending);
    return;
  }
  void Promise.all(list.map((annotation) => refineCross(annotation, invoke)))
    .then((changed) => {
      if (!changed.some(Boolean)) return undefined;
      return import('./rendering.js').then((mod) => mod.redrawAnnotations());
    })
    .catch(() => {});
}

/** Ask the desktop engine for each polyline split that still has a pending crossing. */
export function scheduleSplitRefine(annotations) {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  const list = (Array.isArray(annotations) ? annotations : [annotations]).filter((item) => item?.splitPending);
  if (typeof invoke !== 'function') {
    list.forEach((annotation) => {
      delete annotation.splitPending;
    });
    return;
  }
  void Promise.all(list.map((annotation) => refineSplit(annotation, invoke)))
    .then((changed) => {
      if (!changed.some(Boolean)) return undefined;
      return import('./rendering.js').then((mod) => mod.redrawAnnotations());
    })
    .catch(() => {});
}
