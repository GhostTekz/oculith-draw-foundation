// Line styles and imported hatch patterns for the UI: the built-in set, the
// user's styles and .PAT patterns kept in preferences (`lineStyles`,
// `hatchPatterns`), style-set JSON export/import and .PAT import. Renderers
// and the saver read the same preferences through
// annotations/custom-style-prefs.js; this store only adds reactivity and
// persistence.

import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';
import {
  BUILTIN_LINE_STYLES, cleanLineStyle, newLineStyleId, isBuiltinLineStyleId, MAX_USER_LINE_STYLES,
  buildLineStyleSetBytes, parseLineStyleSetBytes, mergeImportedLineStyles,
} from '../../annotations/line-styles.js';
import { userLineStyles, syncHatchPatternsFromPreferences } from '../../annotations/custom-style-prefs.js';
import { listCustomHatchPatterns, onCustomHatchChange, MAX_CUSTOM_HATCH_PATTERNS } from '../../annotations/hatch-registry.js';
import { parsePatBytes } from '../../annotations/pat-import.js';

const [version, setVersion] = createSignal(0);
const bump = () => setVersion(v => v + 1);
onCustomHatchChange(bump);

function redrawCanvas() {
  import('../../annotations/rendering.js')
    .then(m => (state.documents?.[state.activeDocumentIndex]?.viewMode === 'continuous'
      ? m.redrawContinuous?.() : m.redrawAnnotations?.()))
    .catch(() => {});
}

function persist(key, value) {
  if (!state.preferences) return;
  state.preferences[key] = value;
  try { savePreferences(); } catch (e) { console.warn('Line styles not saved to preferences:', e); }
  bump();
  redrawCanvas();
}

/** Reactive: every style the picker offers, built-ins first. */
export function allLineStyles() {
  version();
  return [...BUILTIN_LINE_STYLES, ...userLineStyles()];
}

export function userStyles() {
  version();
  return userLineStyles();
}

export function lineStylesVersion() { return version(); }

/** Add or replace a user style; returns the clean style or null. */
export function saveUserLineStyle(style) {
  if (!style || isBuiltinLineStyleId(style.id)) return null;
  const clean = cleanLineStyle(style);
  if (!clean) return null;
  const list = userLineStyles();
  const exists = list.some(s => s.id === clean.id);
  if (!exists && list.length >= MAX_USER_LINE_STYLES) return null;
  persist('lineStyles', exists ? list.map(s => (s.id === clean.id ? clean : s)) : [...list, clean]);
  return clean;
}

export function deleteUserLineStyle(id) {
  if (isBuiltinLineStyleId(id)) return false;
  const list = userLineStyles();
  if (!list.some(s => s.id === id)) return false;
  persist('lineStyles', list.filter(s => s.id !== id));
  return true;
}

/** A user copy of any style (built-in or user), named "<name> copy". */
export function duplicateLineStyle(id, copySuffix = 'copy') {
  const source = allLineStyles().find(s => s.id === id);
  if (!source) return null;
  const copy = { ...cleanLineStyle(source), id: newLineStyleId(userLineStyles()),
    name: `${source.name} ${copySuffix}`.slice(0, 64) };
  return saveUserLineStyle(copy);
}

/** A blank user style to start editing from. */
export function newBlankLineStyle(name = 'New style') {
  return { id: newLineStyleId(userLineStyles()), name, scaleWithWidth: false,
    lines: [{ offset: 0, dash: [], width: 1 }], marks: [] };
}

export function exportLineStyleSet(name, ids = null) {
  const styles = ids ? allLineStyles().filter(s => ids.includes(s.id)) : userLineStyles();
  return buildLineStyleSetBytes(name, styles);
}

/** Import a style-set file into the user's styles. */
export function importLineStyleSet(bytes) {
  const parsed = parseLineStyleSetBytes(bytes);
  const { styles, added } = mergeImportedLineStyles(userLineStyles(), parsed.styles);
  if (added.length) persist('lineStyles', styles);
  return { added, skipped: parsed.skipped + (parsed.styles.length - added.length) };
}

// ── imported hatch patterns ────────────────────────────────────────────────

/** Reactive list of imported .PAT patterns (preferences plus those from open PDFs). */
export function importedHatchPatterns() {
  version();
  syncHatchPatternsFromPreferences();
  return listCustomHatchPatterns();
}

/** Import a .PAT file; a pattern with an existing id is replaced. */
export function importPatFile(bytes, unit = 'mm') {
  const { patterns, warnings } = parsePatBytes(bytes, { unit });
  if (!patterns.length) return { added: [], warnings };
  syncHatchPatternsFromPreferences();
  const current = Array.isArray(state.preferences?.hatchPatterns) ? state.preferences.hatchPatterns : [];
  const ids = new Set(patterns.map(p => p.id));
  const next = [...current.filter(p => !ids.has(p?.id)), ...patterns].slice(-MAX_CUSTOM_HATCH_PATTERNS);
  persist('hatchPatterns', next);
  syncHatchPatternsFromPreferences();
  return { added: patterns, warnings };
}

export function deleteImportedHatchPattern(id) {
  const current = Array.isArray(state.preferences?.hatchPatterns) ? state.preferences.hatchPatterns : [];
  if (!current.some(p => p?.id === id)) return false;
  persist('hatchPatterns', current.filter(p => p?.id !== id));
  syncHatchPatternsFromPreferences();
  return true;
}
