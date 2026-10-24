// Custom hatch patterns next to the built-in catalog: patterns imported from
// AutoCAD .PAT files (kept in preferences) and patterns a PDF carried in
// /OPS_HatchDef (kept for the session). Pure and dependency-free: the canvas
// renderer (rendering/hatch-patterns.js) and the appearance writer
// (pdf/saver/hatch-catalog.js) both read it, also in headless Node tests.
//
// Ids are namespaced (`pat:ANSI31`) so they never collide with built-in ids.
// Families use the line-family format of hatch-patterns.js with `pat: true`:
// dashes are anchored at each line's base point and a 0 in the dash list is a
// dot, exactly as in the .PAT format (see hatch-pat-geometry.js).

export const CUSTOM_HATCH_PREFIX = 'pat:';
export const MAX_CUSTOM_HATCH_PATTERNS = 200;
export const MAX_PATTERN_FAMILIES = 64;
export const MAX_FAMILY_DASHES = 32;

const ID_RE = /^pat:[A-Za-z0-9_.-]{1,48}$/u;

const user = new Map();      // id → def (preferences)
const documentDefs = new Map(); // id → def (read from an opened PDF)
const listeners = new Set();
let version = 0;

function changed() {
  version++;
  for (const fn of listeners) { try { fn(version); } catch { /* listener errors stay local */ } }
}

/** Subscribe to registry changes; returns an unsubscribe function. */
export function onCustomHatchChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function customHatchVersion() { return version; }

const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1e6) / 1e6 : null;
};

/** A safe copy of one PAT line family (page points), or null. */
export function cleanPatFamily(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const angle = num(raw.angle, -3600, 3600);
  const originX = num(raw.originX ?? 0, -1e5, 1e5);
  const originY = num(raw.originY ?? 0, -1e5, 1e5);
  const deltaX = num(raw.deltaX ?? 0, -1e5, 1e5);
  const deltaY = num(raw.deltaY, 0.05, 1e5);
  if ([angle, originX, originY, deltaX, deltaY].some(v => v === null)) return null;
  const fam = { angle, originX, originY, deltaX, deltaY, pat: true };
  if (Array.isArray(raw.dashPattern) && raw.dashPattern.length) {
    const dash = raw.dashPattern.slice(0, MAX_FAMILY_DASHES).map(v => num(v, -1e5, 1e5));
    if (dash.some(v => v === null)) return null;
    const period = dash.reduce((s, v) => s + Math.abs(v), 0);
    // A dash list without length draws nothing sensible: keep the line solid.
    if (period >= 0.01) fam.dashPattern = dash;
  }
  return fam;
}

/** A safe copy of a custom pattern definition, or null. */
export function cleanHatchPatternDef(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  const text = (v, max) => (typeof v === 'string'
    // eslint-disable-next-line no-control-regex
    ? v.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim().slice(0, max) : '');
  const families = (Array.isArray(raw.families) ? raw.families : []).slice(0, MAX_PATTERN_FAMILIES)
    .map(cleanPatFamily).filter(Boolean);
  if (!families.length) return null;
  return { id: raw.id, name: text(raw.name, 48) || raw.id.slice(CUSTOM_HATCH_PREFIX.length),
    description: text(raw.description, 120), families };
}

/** Replace the user's imported patterns (from preferences). Invalid entries are dropped. */
export function setUserHatchPatterns(list) {
  user.clear();
  for (const raw of (Array.isArray(list) ? list : []).slice(0, MAX_CUSTOM_HATCH_PATTERNS)) {
    const def = cleanHatchPatternDef(raw);
    if (def) user.set(def.id, def);
  }
  changed();
}

let seenUserList;
/** setUserHatchPatterns, but only when `list` is a different object than last time (preferences sync). */
export function syncUserHatchPatterns(list) {
  if (list === seenUserList) return;
  seenUserList = list;
  setUserHatchPatterns(list);
}

/**
 * A pattern a PDF carried. The user's own pattern with that id wins; the
 * document copy only fills in a pattern this machine does not know.
 */
export function registerDocumentHatchPattern(raw) {
  const def = cleanHatchPatternDef(raw);
  if (!def || user.has(def.id) || documentDefs.has(def.id)) return def && (user.get(def.id) || documentDefs.get(def.id));
  if (documentDefs.size >= MAX_CUSTOM_HATCH_PATTERNS) return null;
  documentDefs.set(def.id, def);
  changed();
  return def;
}

export function isCustomHatchId(id) { return typeof id === 'string' && id.startsWith(CUSTOM_HATCH_PREFIX); }

export function getCustomHatchPattern(id) {
  return user.get(id) || documentDefs.get(id) || null;
}

/** All custom patterns: the user's first, then those only known from documents. */
export function listCustomHatchPatterns() {
  return [...user.values(), ...[...documentDefs.values()].filter(d => !user.has(d.id))];
}
