// Schedule total for polygonal areas that share one scale. Overlaps on the
// same page count once. Each row stays the area of that shape. A missing
// command, a circle, an ellipse, a rectangular cloud, a mixed or missing
// unit, or an external-file measurement leaves the arithmetic sum.

import { buildSchedule } from './engine.js';
import { normaliseerMeting } from './categories.js';
import { classifiedRings, shapeRings } from '../annotations/geos-area.js';
import { getMeasureScale } from '../annotations/measurement.js';
import { state } from '../core/state.js';

const RING_TYPES = new Set(['measureArea', 'filledArea', 'polygon', 'cloudPolyline', 'box']);

const areaCache = new Map();
const inflight = new Map();

export function clearGroupNetCache() {
  areaCache.clear();
  inflight.clear();
}

export function settleGroupNet() {
  return Promise.all(Array.from(inflight.values())).then(() => {});
}

function desktopInvoke() {
  const invoke = globalThis.window?.__TAURI__?.core?.invoke;
  return typeof invoke === 'function' ? invoke : null;
}

function pointerIsLive() {
  return !!(state.isDragging || state.isDrawing || state.isResizing);
}

function qn(value) {
  return Math.round(value * 1e6) / 1e6;
}

function quantizeRing(ring) {
  return ring.map((point) => [qn(point[0]), qn(point[1])]);
}

function shapesFrom(items) {
  const shapes = items.map((item) => ({
    parts: item.rings.parts,
    holes: item.rings.holes || [],
  }));
  shapes.sort((a, b) => JSON.stringify({
    parts: a.parts.map(quantizeRing),
    holes: a.holes.map(quantizeRing),
  }).localeCompare(JSON.stringify({
    parts: b.parts.map(quantizeRing),
    holes: b.holes.map(quantizeRing),
  })));
  return shapes;
}

function jobKey(scale, shapes) {
  return JSON.stringify({
    ppu: scale.ppu,
    unit: scale.unit,
    shapes: shapes.map((shape) => ({
      parts: shape.parts.map(quantizeRing),
      holes: shape.holes.map(quantizeRing),
    })),
  });
}

function scaleOf(el) {
  if (el.type === 'measureArea') {
    const points = el.points || [];
    if (points.length === 0) return null;
    const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const scale = getMeasureScale(el.page, cx, cy);
    if (!(scale?.pixelsPerUnit > 0) || !scale.unit) return null;
    return { ppu: scale.pixelsPerUnit, unit: scale.unit };
  }
  if (el.__pxPerUnit == null) return { ppu: 1, unit: 'pt' };
  if (!(el.__pxPerUnit > 0) || !el.__unit) return null;
  return { ppu: el.__pxPerUnit, unit: el.__unit };
}

function boxRing(el) {
  const { x, y, width, height } = el;
  if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const x0 = Math.min(x, x + width);
  const y0 = Math.min(y, y + height);
  const x1 = Math.max(x, x + width);
  const y1 = Math.max(y, y + height);
  if (x1 === x0 || y1 === y0) return null;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function ringsOf(el) {
  if (el.type === 'box') {
    const ring = boxRing(el);
    return ring ? { parts: [ring], holes: [] } : null;
  }
  if (el.type === 'measureArea') {
    if (!Array.isArray(el.points) || el.points.length < 3) return null;
    return classifiedRings(el.points, el.holes);
  }
  return shapeRings(el);
}

function toColumnUnits(pagePoints, scale) {
  const measured = normaliseerMeting(pagePoints / (scale.ppu * scale.ppu), `${scale.unit}\u00B2`);
  return measured ? measured.value : null;
}

function areaItems(result) {
  const items = [];
  result.groups.forEach((group, groupIndex) => {
    group.rows.forEach((row) => {
      if (typeof row.vals?.area === 'number' && Number.isFinite(row.vals.area)) {
        items.push({ row, groupIndex });
      }
    });
  });
  return items;
}

function jobsFor(items, scale, target, bucket) {
  const byPage = new Map();
  items.forEach((item) => {
    const page = item.row.el.page || 1;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(item);
  });
  byPage.forEach((pageItems) => {
    if (pageItems.length < 2) return;
    const shapes = shapesFrom(pageItems);
    const key = jobKey(scale, shapes);
    let job = bucket.get(key);
    if (!job) {
      job = {
        key,
        shapes,
        rowSum: pageItems.reduce((sum, item) => sum + item.row.vals.area, 0),
        grand: false,
        groups: [],
      };
      bucket.set(key, job);
    }
    if (target === 'grand') job.grand = true;
    else if (!job.groups.includes(target)) job.groups.push(target);
  });
}

function groupPlan(result) {
  if (typeof result?.grandTotals?.area !== 'number') return null;
  const items = areaItems(result);
  if (items.length < 2) return null;
  if (items.some(({ row }) => row.el?.extMeasure || !RING_TYPES.has(row.el?.type))) return null;

  const prepared = [];
  for (const item of items) {
    const scale = scaleOf(item.row.el);
    const rings = ringsOf(item.row.el);
    if (!scale || !rings?.parts?.length) return null;
    prepared.push({ ...item, rings });
  }
  const scale = prepared[0] && scaleOf(prepared[0].row.el);
  if (!scale || !prepared.every((item) => {
    const next = scaleOf(item.row.el);
    return next && next.ppu === scale.ppu && next.unit === scale.unit;
  })) return null;

  const bucket = new Map();
  jobsFor(prepared, scale, 'grand', bucket);
  result.groups.forEach((_, index) => {
    jobsFor(prepared.filter((item) => item.groupIndex === index), scale, index, bucket);
  });
  const jobs = [...bucket.values()];
  if (jobs.length === 0) return null;
  return { scale, jobs };
}

function applyJobs(result, jobs) {
  let grand = result.grandTotals.area;
  let grandTouched = false;
  const groupDelta = result.groups.map(() => 0);
  const groupTouched = result.groups.map(() => false);
  for (const job of jobs) {
    const net = areaCache.get(job.key);
    if (typeof net !== 'number') return result;
    const delta = net - job.rowSum;
    if (job.grand) {
      grand += delta;
      grandTouched = true;
    }
    job.groups.forEach((index) => {
      groupDelta[index] += delta;
      groupTouched[index] = true;
    });
  }
  return {
    ...result,
    grandTotals: grandTouched ? { ...result.grandTotals, area: grand } : result.grandTotals,
    groups: result.groups.map((group, index) => {
      if (!groupTouched[index] || typeof group.subtotals?.area !== 'number') return group;
      return {
        ...group,
        subtotals: { ...group.subtotals, area: group.subtotals.area + groupDelta[index] },
      };
    }),
  };
}

function startJobs(plan, caller, note) {
  const missing = plan.jobs.filter((job) => !areaCache.has(job.key));
  if (missing.length === 0) return;
  const signature = missing.map((job) => job.key).sort().join('\n');
  if (inflight.has(signature)) return;
  const promise = Promise.all(missing.map(async (job) => {
    const pixels = await caller('geos_group_net_area', { shapes: job.shapes });
    if (typeof pixels !== 'number' || !Number.isFinite(pixels)) throw new Error('group net');
    const converted = toColumnUnits(pixels, plan.scale);
    if (converted == null) throw new Error('group net unit');
    areaCache.set(job.key, converted);
  })).then(() => {
    inflight.delete(signature);
    const changed = missing.some((job) => Math.abs(areaCache.get(job.key) - job.rowSum) > 1e-6);
    if (note && changed) {
      void import('../annotations/geometry-revision.js').then((mod) => mod.noteGeometry()).catch(() => {});
    }
  }).catch(() => {
    inflight.delete(signature);
  });
  inflight.set(signature, promise);
}

/** Build a schedule, replacing the area total when a same-page union is known. */
export function scheduleWithGroupNet(elements, cfg, invoke) {
  const result = buildSchedule(elements, cfg || {});
  const plan = groupPlan(result);
  if (!plan) return result;
  const caller = typeof invoke === 'function' ? invoke : (invoke === undefined ? desktopInvoke() : null);
  if (plan.jobs.every((job) => areaCache.has(job.key))) return applyJobs(result, plan.jobs);
  if (caller && !pointerIsLive()) startJobs(plan, caller, invoke === undefined);
  return result;
}

/** Resolve the desktop union, then build the schedule again with that total. */
export async function refineScheduleGroupNet(elements, cfg, invoke) {
  scheduleWithGroupNet(elements, cfg, invoke);
  await settleGroupNet();
  return scheduleWithGroupNet(elements, cfg, invoke);
}
