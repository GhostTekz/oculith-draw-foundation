import { $RAW } from 'solid-js/store';
// Spaces (the external editor Window ▸ Spaces): named, optionally nested regions of a page.
// Every markup gets a computed, read-only "Space": the deepest space that
// holds its anchor point, written as a path "Building ▸ Room ▸ Closet".
//
// Two kinds of space, one list:
//   stored  doc.spaces: { id, page, name, color, parentId, points, hidden }
//           drawn in the Spaces panel (rectangle/polygon) or copied from an
//           area measurement. Saved per page in /OPS_Spaces (pdf-spaces.js).
//   room    a floor-plan room (plattegrond/ruimte-koppeling.js isRuimteVlak:
//           a measureArea with opsRuimteNaam/opsRuimteZaad), also what
//           Dynamic Fill's Space output creates. The room annotation is the
//           space; its colour and outline visibility live on the annotation
//           (opsSpaceColor, opsSpaceHidden; saver/plattegrond-meta.js).
//
// Nesting: a stored space may name its parent (parentId). Without one (or
// with a parent that no longer exists, is on another page or would make a
// loop) the parent is the smallest larger space on the page that holds the
// space's label point. Geometry is in app page coordinates (y down), like
// every markup (AGENTS.md).
//
// Pure: no app state. Callers pass the document.

import { isRuimteVlak } from '../plattegrond/ruimte-koppeling.js';
import { labelPunt, puntInPolygoon, vlak } from '../plattegrond/ruimte.js';

export const SPACE_PATH_SEPARATOR = ' ▸ ';
export const SPACE_NAME_MAX = 128;
export const MAX_SPACES_PER_PAGE = 500;
export const MAX_SPACE_POINTS = 2000;
export const ROOM_SPACE_PREFIX = 'room:';
export const DEFAULT_ROOM_COLOR = '#2f80ed';
/** Colours handed out to new spaces in turn. */
export const SPACE_COLORS = Object.freeze([
  '#2f80ed', '#27ae60', '#eb5757', '#f2994a', '#9b51e0', '#00a3a3', '#d4a017', '#e056a0',
]);

const finite = (...v) => v.every((n) => Number.isFinite(n));
const HEX = /^#[0-9a-f]{6}$/i;

/** A valid #rrggbb colour (lower case), or the fallback. */
export function spaceColor(value, fallback = DEFAULT_ROOM_COLOR) {
  return typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/** A trimmed single-line name of at most SPACE_NAME_MAX characters. */
export function spaceName(value) {
  return String(value ?? '').replace(/[\r\n\t]+/gu, ' ').trim().slice(0, SPACE_NAME_MAX);
}

function cleanPoints(points) {
  if (!Array.isArray(points)) return null;
  const out = [];
  for (const p of points.slice(0, MAX_SPACE_POINTS)) {
    if (p && finite(p.x, p.y)) out.push({ x: p.x, y: p.y });
  }
  return out.length >= 3 && vlak(out) > 1e-9 ? out : null;
}

/** A clean stored space, or null when it cannot be one. */
export function normalizeSpace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const page = Number(raw.page);
  const points = cleanPoints(raw.points);
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : '';
  if (!id || id.startsWith(ROOM_SPACE_PREFIX) || !Number.isInteger(page) || page < 1 || !points) return null;
  const parentId = typeof raw.parentId === 'string' && raw.parentId && raw.parentId !== id ? raw.parentId : null;
  return {
    id, page, points, parentId,
    name: spaceName(raw.name) || 'Space',
    color: spaceColor(raw.color, SPACE_COLORS[0]),
    hidden: raw.hidden === true,
  };
}

let idCounter = 0;
/** A new space id, unique among `used` (a Set of ids). */
export function newSpaceId(used = new Set()) {
  let id;
  do {
    idCounter += 1;
    id = `sp-${Date.now().toString(36)}-${idCounter.toString(36)}`;
  } while (used.has(id));
  return id;
}

/** The space of a floor-plan room annotation (null for any other markup). */
export function roomSpace(ann) {
  if (!isRuimteVlak(ann)) return null;
  const points = cleanPoints(ann.points);
  if (!points) return null;
  const name = spaceName(ann.opsRuimteNaam) || spaceName(ann.measureName)
    || (ann.opsRuimteNummer ? `Room ${spaceName(ann.opsRuimteNummer)}` : 'Room');
  return {
    id: ROOM_SPACE_PREFIX + ann.id,
    page: Number(ann.page) || 1,
    name,
    color: spaceColor(ann.opsSpaceColor, DEFAULT_ROOM_COLOR),
    parentId: null,
    points,
    hidden: ann.opsSpaceHidden === true,
    source: 'room',
    annotationId: ann.id,
  };
}

/** Is this space id a floor-plan room? */
export function isRoomSpaceId(id) {
  return typeof id === 'string' && id.startsWith(ROOM_SPACE_PREFIX);
}

/**
 * Every space of the document with its resolved nesting:
 * { ...space, source, area, label, parent (id|null), depth, path: [names] }.
 * Pages in order; within a page stored spaces first, then rooms.
 */
export function collectSpaces(doc) {
  const stored = (Array.isArray(doc?.spaces) ? doc.spaces : [])
    .map(normalizeSpace).filter(Boolean)
    .map((s) => ({ ...s, source: 'space' }));
  // Only area measurements can be rooms: that test on the raw list, then the
  // candidates through the store (a room's edits still count). Through the
  // store every markup went through a proxy, at 20,000 markups a real part
  // of an open.
  const lijst = Array.isArray(doc?.annotations) ? doc.annotations : [];
  const ruw = lijst[$RAW] || lijst;
  const rooms = [];
  for (let i = 0, n = lijst.length; i < n; i++) {
    if (ruw[i]?.type !== 'measureArea') continue;
    const room = roomSpace(lijst[i]);
    if (room) rooms.push(room);
  }
  const seen = new Set();
  const all = [];
  for (const s of [...stored, ...rooms]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    all.push({ ...s, area: vlak(s.points), label: labelPunt(s.points) || s.points[0] });
  }
  const byId = new Map(all.map((s) => [s.id, s]));

  // Auto parent: the smallest larger space on the page holding the label point.
  const autoParent = (s) => {
    let best = null;
    for (const o of all) {
      if (o === s || o.page !== s.page || !(o.area > s.area)) continue;
      if (!puntInPolygoon(s.label, o.points)) continue;
      if (!best || o.area < best.area) best = o;
    }
    return best ? best.id : null;
  };
  for (const s of all) {
    const explicit = s.parentId && byId.get(s.parentId);
    s.parent = explicit && explicit.page === s.page ? explicit.id : autoParent(s);
  }
  // Break loops from explicit parents: the space that closes a loop falls
  // back to having no parent.
  for (const s of all) {
    const seenChain = new Set([s.id]);
    let p = s.parent;
    while (p) {
      if (seenChain.has(p)) { s.parent = null; break; }
      seenChain.add(p);
      p = byId.get(p)?.parent || null;
    }
  }
  for (const s of all) {
    const names = [];
    let cur = s;
    while (cur) { names.unshift(cur.name); cur = cur.parent ? byId.get(cur.parent) : null; }
    s.path = names;
    s.depth = names.length - 1;
  }
  all.sort((a, b) => a.page - b.page);
  return all;
}

/** "Space ▸ Subspace" of a resolved space (or '' for none). */
export function spacePathText(space) {
  return space?.path?.length ? space.path.join(SPACE_PATH_SEPARATOR) : '';
}

/** The spaces of `page` as a tree order: parents before their children. */
export function spaceTree(spaces, page = null) {
  const list = (spaces || []).filter((s) => page == null || s.page === page);
  const ids = new Set(list.map((s) => s.id));
  const children = new Map();
  for (const s of list) {
    const key = s.parent && ids.has(s.parent) ? s.parent : `page:${s.page}`;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(s);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const out = [];
  const walk = (key, level) => {
    for (const s of (children.get(key) || []).sort(byName)) {
      out.push({ space: s, level });
      walk(s.id, level + 1);
    }
  };
  const pages = [...new Set(list.map((s) => s.page))].sort((a, b) => a - b);
  for (const p of pages) walk(`page:${p}`, 0);
  return out;
}

/** The deepest space on `page` that holds `point`, or null. */
export function spaceAt(spaces, page, point) {
  if (!point || !finite(point.x, point.y)) return null;
  let best = null;
  for (const s of spaces || []) {
    if (s.page !== page || !puntInPolygoon(point, s.points)) continue;
    if (!best || s.depth > best.depth || (s.depth === best.depth && s.area < best.area)) best = s;
  }
  return best;
}

function simpleBounds(a) {
  const pts = Array.isArray(a.points) && a.points.length ? a.points
    : Array.isArray(a.path) && a.path.length ? a.path
      : Array.isArray(a.controlPoints) && a.controlPoints.length ? a.controlPoints : null;
  if (pts) {
    const xs = pts.map((p) => p.x).filter(Number.isFinite);
    const ys = pts.map((p) => p.y).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  if (finite(a.startX, a.startY, a.endX, a.endY)) {
    const x = Math.min(a.startX, a.endX), y = Math.min(a.startY, a.endY);
    return { x, y, width: Math.abs(a.endX - a.startX), height: Math.abs(a.endY - a.startY) };
  }
  if (finite(a.centerX, a.centerY)) {
    const r = Number(a.radius) || 0;
    return { x: a.centerX - r, y: a.centerY - r, width: 2 * r, height: 2 * r };
  }
  if (finite(a.x, a.y)) return { x: a.x, y: a.y, width: Number(a.width) || 0, height: Number(a.height) || 0 };
  return null;
}

// Closed shapes whose points outline a region: the anchor is a point inside it.
const REGION_TYPES = new Set(['measureArea', 'measureVolume', 'filledArea', 'polygon', 'cloud', 'systeemraster']);

/**
 * The point that decides a markup's space: inside a closed region (its label
 * point), the middle of a line, the centre of anything else.
 * `boundsOf(ann)` is a fallback for shapes this module does not know.
 */
export function markupAnchor(ann, boundsOf = null) {
  if (!ann) return null;
  if (REGION_TYPES.has(ann.type) && Array.isArray(ann.points) && ann.points.length >= 3) {
    const pts = ann.points.filter((p) => p && finite(p.x, p.y));
    const p = pts.length >= 3 ? labelPunt(pts) : null;
    if (p && finite(p.x, p.y)) return p;
  }
  if (finite(ann.startX, ann.startY, ann.endX, ann.endY) && !Array.isArray(ann.points)) {
    return { x: (ann.startX + ann.endX) / 2, y: (ann.startY + ann.endY) / 2 };
  }
  const b = simpleBounds(ann) || (typeof boundsOf === 'function' ? boundsOf(ann) : null);
  if (!b || !finite(b.x, b.y)) return null;
  return { x: b.x + (Number(b.width) || 0) / 2, y: b.y + (Number(b.height) || 0) / 2 };
}

/**
 * A resolver for the Space column: (ann) → resolved space or null. One
 * collectSpaces pass for all markups of a list build.
 */
export function markupSpaceResolver(doc, boundsOf = null) {
  const spaces = collectSpaces(doc);
  if (!spaces.length) return () => null;
  const byPage = new Map();
  for (const s of spaces) {
    if (!byPage.has(s.page)) byPage.set(s.page, []);
    byPage.get(s.page).push(s);
  }
  return (ann) => {
    // Read on every count. The flag is set after this resolver is built.
    if (ann?.type === 'count' && ann.engineOutsideSpace === true) return null;
    const list = byPage.get(Number(ann?.page) || 1);
    if (!list) return null;
    return spaceAt(list, Number(ann.page) || 1, markupAnchor(ann, boundsOf));
  };
}

/**
 * (ann) → "Space ▸ Subspace" text ('' outside every space). Remembers each
 * markup's answer: make a new one after markups or spaces change.
 */
export function markupSpacePather(doc, boundsOf = null) {
  const resolve = markupSpaceResolver(doc, boundsOf);
  const seen = new WeakMap();
  return (ann) => {
    if (ann && typeof ann === 'object' && seen.has(ann)) return seen.get(ann);
    const text = spacePathText(resolve(ann));
    if (ann && typeof ann === 'object') seen.set(ann, text);
    return text;
  };
}

/** Is a Space path the space `filterPath` itself or inside it? */
export function spacePathWithin(path, filterPath) {
  const p = String(path ?? '');
  const f = String(filterPath ?? '');
  if (!f) return true;
  return p === f || p.startsWith(f + SPACE_PATH_SEPARATOR);
}

/** The markups (not rooms of the space itself excluded) whose Space is `spaceId` or one of its sub-spaces. */
export function markupsInSpace(doc, spaceId, boundsOf = null) {
  const spaces = collectSpaces(doc);
  const target = spaces.find((s) => s.id === spaceId);
  if (!target) return [];
  const prefix = spacePathText(target);
  const pather = markupSpacePather(doc, boundsOf);
  return (doc?.annotations || []).filter((a) => a.type !== 'scaleRegion' && spacePathWithin(pather(a), prefix));
}

// ── stored-space edits (pure: a new array each time) ─────────────────────

/** The stored spaces with `space` added (normalised; auto id and colour). */
export function withSpaceAdded(spaces, space) {
  const list = Array.isArray(spaces) ? spaces.map((s) => ({ ...s })) : [];
  const used = new Set(list.map((s) => s.id));
  const color = space?.color || SPACE_COLORS[list.length % SPACE_COLORS.length];
  const id = space?.id && !used.has(space.id) ? space.id : newSpaceId(used);
  const clean = normalizeSpace({ ...space, id, color });
  if (!clean) return list;
  if (list.filter((s) => s.page === clean.page).length >= MAX_SPACES_PER_PAGE) return list;
  return [...list, clean];
}

/** The stored spaces with `patch` applied to the space `id`. */
export function withSpaceChanged(spaces, id, patch) {
  return (spaces || []).map((s) => {
    if (s.id !== id) return { ...s };
    const next = normalizeSpace({ ...s, ...patch, id: s.id, page: s.page });
    return next || { ...s };
  });
}

/**
 * The stored spaces without `id`. Its children that named it as parent move
 * up to its own parent.
 */
export function withSpaceRemoved(spaces, id) {
  const gone = (spaces || []).find((s) => s.id === id);
  return (spaces || []).filter((s) => s.id !== id)
    .map((s) => (s.parentId === id ? { ...s, parentId: gone?.parentId || null } : { ...s }));
}

/** Spaces follow their pages after insert/delete/move (mapping old → new page). */
export function spacesOnPages(spaces, pageMapping) {
  if (!Array.isArray(spaces) || !pageMapping) return spaces;
  const out = [];
  for (const s of spaces) {
    const page = pageMapping[s.page];
    if (page !== undefined && page !== null) out.push({ ...s, points: s.points.map((p) => ({ ...p })), page });
  }
  return out;
}

/** Name for a new space: "Space N", the first N not taken on the page. */
export function nextSpaceName(spaces, page, base = 'Space') {
  const taken = new Set((spaces || []).filter((s) => s.page === page).map((s) => s.name));
  let n = 1;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** A closed outline from an existing markup (area measurement, polygon, box…), or null. */
export function outlineOfMarkup(ann) {
  if (!ann) return null;
  if (Array.isArray(ann.points) && ann.points.length >= 3
    && (REGION_TYPES.has(ann.type) || ann.type === 'cloudPolyline' || ann.type === 'polyline' || ann.type === 'measurePerimeter')) {
    return cleanPoints(ann.points);
  }
  if (['box', 'circle', 'ellipse', 'highlight', 'mask'].includes(ann.type) && finite(ann.x, ann.y, ann.width, ann.height)) {
    const { x, y, width: w, height: h } = ann;
    if (!(w > 0 && h > 0)) return null;
    if (ann.type === 'circle' || ann.type === 'ellipse') {
      const n = 48, cx = x + w / 2, cy = y + h / 2;
      return Array.from({ length: n }, (_, i) => ({
        x: cx + (w / 2) * Math.cos((2 * Math.PI * i) / n),
        y: cy + (h / 2) * Math.sin((2 * Math.PI * i) / n),
      }));
    }
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  }
  return null;
}

/**
 * Bring the spaces read from the file into the model (at open). Ids already
 * in the model are not added twice. Marks the document as read so the saver
 * may replace the file's spaces.
 */
export function takeOverSpaces(doc, items) {
  if (!doc) return 0;
  const list = Array.isArray(doc.spaces) ? [...doc.spaces] : [];
  const ids = new Set(list.map((s) => s.id));
  let n = 0;
  for (const item of items || []) {
    const s = normalizeSpace(item);
    if (!s || ids.has(s.id)) continue;
    ids.add(s.id);
    list.push(s);
    n += 1;
  }
  doc.spaces = list;
  doc._spacesRead = true;
  return n;
}

// ── Quantities ───────────────────────────────────────────────────────────

/**
 * Quantities elements with their Space path in `__space` (the Space field of
 * quantities/categories.js). Unchanged when the document has no spaces.
 */
export function withSpacePaths(elements, doc, boundsOf = null) {
  if (!collectSpaces(doc).length) return elements;
  const pather = markupSpacePather(doc, boundsOf);
  return (elements || []).map((el) => (el && typeof el === 'object' ? { ...el, __space: pather(el) } : el));
}

/** Only the elements in the space `path` or one of its sub-spaces ('' = all). */
export function elementsInSpace(elements, path) {
  if (!path) return elements;
  return (elements || []).filter((el) => spacePathWithin(el?.__space || '', path));
}
