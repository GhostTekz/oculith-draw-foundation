// Dynamic Fill session: the fills and temporary boundary lines of the active
// tool, its options, and Apply / Clear. The canvas tool
// (tools/dynamic-fill-tool.js), the options bar (DynamicFillBar.jsx) and the
// overlay pass in rendering.js all read this one module.
//
// Fills live on one page at a time. Boundary lines only steer the fill; they
// never reach the PDF and are cleared after Apply.

import { createSignal } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import {
  regionContains, polylineSegments, DYNAMIC_FILL_OUTPUTS, boundarySegments as weightedSegments,
} from './fill-region.js';
import * as engine from './fill-engine.js';
import { exactClosedFace } from './fill-exact.js';

export const DYNAMIC_FILL_MODES = Object.freeze(['fill', 'boundary']);
export const MAX_GAP = 200;
export const MAX_MIN_WEIGHT = 10;
export const DEFAULT_FILL_COLOR = '#0096ff';
export const DEFAULT_BOUNDARY_COLOR = '#e8590c';

const HEX = /^#[0-9a-f]{6}$/i;
const clampWeight = (v) => Math.max(0, Math.min(MAX_MIN_WEIGHT, Number(v) || 0));
const colour = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

const prefs = () => state.preferences || {};

/** Known outputs in display order; empty or unknown → ['area']. */
export function normaliseOutputs(list) {
  const set = new Set(Array.isArray(list) ? list : [list]);
  const out = DYNAMIC_FILL_OUTPUTS.filter((id) => set.has(id));
  return out.length ? out : ['area'];
}

function initialOptions() {
  const p = prefs();
  const outputs = normaliseOutputs(p.dynamicFillOutputs ?? p.dynamicFillOutput);
  const gap = Number(p.dynamicFillGap);
  return {
    outputs, gap: gap >= 0 && gap <= MAX_GAP ? gap : 0, mode: 'fill',
    // the external editor Dynamic Fill Settings: preview colours, and hiding the markups
    // while the tool is active (view only; printing and saving keep them).
    fillColor: colour(p.dynamicFillColor, DEFAULT_FILL_COLOR),
    boundaryColor: colour(p.dynamicFillBoundaryColor, DEFAULT_BOUNDARY_COLOR),
    hideMarkups: p.dynamicFillHideMarkups === true,
    // the external editor Edge Sensitivity: stroked lines thinner than this (pt) are not
    // boundaries. 0 = every painted line counts.
    minWeight: clampWeight(p.dynamicFillMinWeight),
    // Name for Space output (the external editor asks it in the Create menu); '' = the
    // translated default. Not remembered: each takeoff names its own rooms.
    spaceName: '',
  };
}

const [options, setOptionsSignal] = createSignal(initialOptions());
// fills/boundaries counts, the last message key and busy flag for the bar.
const [status, setStatus] = createSignal({ fills: 0, boundaries: 0, drafting: false, message: '', busy: false });
export { options, status };

const session = {
  page: null,
  docId: null,
  regions: [],      // fill-region.js results
  boundaries: [],   // finished boundary polylines [[{x,y}...]]
  draft: [],        // boundary being drawn
  hover: null,      // cursor point while drawing a boundary
};
let requestToken = 0;

function sync(message) {
  setStatus((s) => ({
    ...s,
    fills: session.regions.length,
    boundaries: session.boundaries.length,
    drafting: session.draft.length > 0,
    ...(message !== undefined ? { message } : {}),
  }));
}

function redraw() {
  import('../../annotations/rendering.js').then((m) => {
    if (getActiveDocument()?.viewMode === 'continuous') m.redrawContinuous();
    else m.redrawAnnotations();
  }).catch(() => {});
}

/** Toggle one output on or off (at least one stays on). */
export function toggleOutput(id) {
  const cur = options().outputs;
  const next = cur.includes(id) ? cur.filter((o) => o !== id) : [...cur, id];
  if (next.length) setOptions({ outputs: next });
}

/**
 * Change outputs/gap/mode/settings (`output: id` is short for
 * `outputs: [id]`). Everything but the mode is remembered in preferences.
 */
export function setOptions(patch) {
  const { output, ...rest } = patch;
  const next = { ...options(), ...rest };
  if (output !== undefined) next.outputs = [output];
  next.outputs = normaliseOutputs(next.outputs);
  if (!DYNAMIC_FILL_MODES.includes(next.mode)) next.mode = 'fill';
  next.gap = Math.max(0, Math.min(MAX_GAP, Number(next.gap) || 0));
  next.fillColor = colour(next.fillColor, DEFAULT_FILL_COLOR);
  next.boundaryColor = colour(next.boundaryColor, DEFAULT_BOUNDARY_COLOR);
  next.hideMarkups = next.hideMarkups === true;
  next.minWeight = clampWeight(next.minWeight);
  next.spaceName = typeof next.spaceName === 'string' ? next.spaceName.slice(0, 80) : '';
  if (next.mode !== 'boundary') { session.draft = []; session.hover = null; }
  setOptionsSignal(next);
  const p = prefs();
  if (String(p.dynamicFillOutputs) !== String(next.outputs) || p.dynamicFillGap !== next.gap
    || p.dynamicFillColor !== next.fillColor || p.dynamicFillBoundaryColor !== next.boundaryColor
    || (p.dynamicFillHideMarkups === true) !== next.hideMarkups
    || clampWeight(p.dynamicFillMinWeight) !== next.minWeight) {
    p.dynamicFillOutputs = [...next.outputs];
    delete p.dynamicFillOutput;
    p.dynamicFillGap = next.gap;
    p.dynamicFillColor = next.fillColor;
    p.dynamicFillBoundaryColor = next.boundaryColor;
    p.dynamicFillHideMarkups = next.hideMarkups;
    p.dynamicFillMinWeight = next.minWeight;
    import('../../core/preferences.js').then((m) => m.savePreferences?.()).catch(() => {});
  }
  sync();
  redraw();
}

// A new document or page starts a clean session.
function bindTo(page) {
  const docId = getActiveDocument()?.id ?? null;
  if (session.page === page && session.docId === docId) return;
  session.page = page;
  session.docId = docId;
  session.regions = [];
  session.boundaries = [];
  session.draft = [];
  session.hover = null;
}

function boundarySegments() {
  return session.boundaries.flatMap((b) => polylineSegments(b));
}

/**
 * Fill the region under (x, y) on `page`.
 * additive false: the region replaces the fills.
 * additive true (Shift/Ctrl+click): add it, or remove the fill already under
 * the click.
 * additive 'paint' (dragging with the button held): add it; a point inside
 * an existing fill does nothing.
 * `loadEdges(page)` resolves to the page's vector segments (injected for
 * tests).
 */
export async function fillAt(page, x, y, additive, loadEdges = defaultLoadEdges) {
  bindTo(page);
  if (additive === 'paint' && session.regions.some((r) => regionContains(r, x, y))) {
    return { status: 'inside' };
  }
  if (additive === true) {
    const hit = session.regions.findIndex((r) => regionContains(r, x, y));
    if (hit >= 0) {
      session.regions.splice(hit, 1);
      sync('removed');
      redraw();
      return { status: 'removed' };
    }
  }
  const token = ++requestToken;
  setStatus((s) => ({ ...s, busy: true }));
  let edges;
  try {
    edges = await loadEdges(page);
  } finally {
    if (token === requestToken) setStatus((s) => ({ ...s, busy: false }));
  }
  if (token !== requestToken || session.page !== page) return { status: 'stale' };
  if (!edges) { sync('extractFailed'); return { status: 'extractFailed' }; }
  if (!edges.length) { sync('noVector'); return { status: 'noVector' }; }
  edges = weighted(edges);
  const boundaries = boundarySegments();
  const { gap } = options();
  // In a Web Worker where available (fill-engine.js): the page stays live.
  setStatus((s) => ({ ...s, busy: true }));
  let result;
  try {
    result = await engine.fill(edges, { x, y }, { gap, boundaries }, additive === 'paint');
  } finally {
    if (token === requestToken) setStatus((s) => ({ ...s, busy: false }));
  }
  if (token !== requestToken || session.page !== page) return { status: 'stale' };
  if (additive === 'paint' && session.regions.some((r) => regionContains(r, x, y))) return { status: 'inside' };
  if (result.status !== 'ok') {
    // While painting, crossing a line or the outside is part of the stroke.
    if (additive !== 'paint') { sync(result.status); redraw(); }
    return result;
  }
  // One polygonize after a committed click. Paint stays the flood, and so does a gap.
  if (additive !== 'paint') {
    const flood = result;
    try {
      const invoke = globalThis.window?.__TAURI__?.core?.invoke;
      result = await exactClosedFace(edges.concat(boundaries), { x, y }, flood, invoke);
    } catch {
      result = flood;
    }
    if (token !== requestToken || session.page !== page) return { status: 'stale' };
  }
  if (additive) session.regions.push(result);
  else session.regions = [result];
  sync('');
  redraw();
  return result;
}

/**
 * Encircling (the external editor: a drag that closes on itself fills everything inside
 * the outline): add every closed region that lies wholly inside `loop`.
 * Regions the loop cuts through are left as they are. Returns the number of
 * regions added.
 */
export async function fillInside(page, loop, loadEdges = defaultLoadEdges) {
  bindTo(page);
  const token = ++requestToken;
  setStatus((st) => ({ ...st, busy: true }));
  try {
    const loaded = await loadEdges(page);
    if (token !== requestToken || session.page !== page) return 0;
    if (!loaded) { sync('extractFailed'); return 0; }
    if (!loaded.length) { sync('noVector'); return 0; }
    const edges = weighted(loaded);
    const boundaries = boundarySegments();
    const { gap } = options();
    const found = await engine.inside(edges, loop, session.regions, { gap, boundaries });
    if (token !== requestToken || session.page !== page) return 0;
    // The engine skipped seeds in the fills passed in, so these are new.
    session.regions.push(...found);
    const added = found.length;
    sync(added ? '' : 'nothingInside');
    redraw();
    return added;
  } finally {
    if (token === requestToken) setStatus((st) => ({ ...st, busy: false }));
  }
}

async function defaultLoadEdges(page) {
  const m = await import('../pdf-snap-extractor.js');
  const geometry = await m.ensurePdfVectorGeometry(page);
  return geometry ? geometry.edges : null;
}

// The page's boundary segments for the current line-weight setting; the
// same array while nothing changes, so the gap-bridge cache holds.
let weightCache = { src: null, min: -1, out: null };
function weighted(edges) {
  const min = options().minWeight;
  if (weightCache.src !== edges || weightCache.min !== min) {
    weightCache = { src: edges, min, out: weightedSegments(edges, min) };
  }
  return weightCache.out;
}

/** Boundary mode: add a point (double-click or Enter finishes the line). */
export function addBoundaryPoint(page, x, y) {
  bindTo(page);
  const last = session.draft[session.draft.length - 1];
  if (last && Math.hypot(last.x - x, last.y - y) < 1e-6) return;
  session.draft.push({ x, y });
  sync('');
  redraw();
}

export function setBoundaryHover(page, x, y) {
  if (session.page !== page || !session.draft.length) return false;
  session.hover = { x, y };
  return true;
}

/** Finish the boundary being drawn (two points or more). */
export function finishBoundary() {
  if (session.draft.length >= 2) session.boundaries.push(session.draft);
  session.draft = [];
  session.hover = null;
  sync('');
  redraw();
}

/** Backspace: the last boundary point, else the last fill. */
export function undoLast() {
  if (session.draft.length) session.draft.pop();
  else if (session.regions.length) session.regions.pop();
  else if (session.boundaries.length) session.boundaries.pop();
  else return false;
  sync('');
  redraw();
  return true;
}

export function clearFills() {
  session.regions = [];
  sync('');
  redraw();
}

export function clearBoundaries() {
  session.boundaries = [];
  session.draft = [];
  session.hover = null;
  sync('');
  redraw();
}

export function clearAll() {
  session.regions = [];
  session.boundaries = [];
  session.draft = [];
  session.hover = null;
  sync('');
  redraw();
}

/** Esc / tool switch: drop everything. */
export function cancel() {
  ++requestToken;
  clearAll();
  setStatus((s) => ({ ...s, message: '', busy: false }));
}

export const hasFills = () => session.regions.length > 0;

/**
 * Apply: create the chosen markup(s) from the fills, record them as one
 * undoable add each, and clear fills and boundary lines.
 */
export async function apply() {
  if (!session.regions.length) return [];
  const doc = getActiveDocument();
  if (!doc || (session.docId != null && doc.id !== session.docId)) { cancel(); return []; }
  const [{ createDynamicFillAnnotations }, { recordAdd }] = await Promise.all([
    import('./outputs.js'), import('../../core/undo-manager.js'),
  ]);
  let spaceName = options().spaceName.trim();
  if (!spaceName && options().outputs.includes('space')) {
    spaceName = await import('../../i18n/config.js')
      .then((m) => m.default.t('common:dynamicFill.spaceDefault'))
      .catch(() => '') || 'Space';
    if (spaceName === 'common:dynamicFill.spaceDefault' || spaceName === 'dynamicFill.spaceDefault') spaceName = 'Space';
  }
  const anns = createDynamicFillAnnotations(session.regions, options().outputs, session.page, { spaceName });
  for (const ann of anns) {
    doc.annotations.push(ann);
    recordAdd(ann);
  }
  clearAll();
  sync(anns.length ? 'applied' : '');
  return anns;
}

/** What the overlay pass draws for `page` (null when nothing). */
export function overlayFor(page) {
  if (session.page !== page) return null;
  if (!session.regions.length && !session.boundaries.length && !session.draft.length) return null;
  return {
    regions: session.regions,
    boundaries: session.boundaries,
    draft: session.draft,
    hover: session.hover,
  };
}

/** For tests. */
export function _session() { return session; }
