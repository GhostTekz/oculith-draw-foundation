// The user's line styles and imported hatch patterns live in preferences
// (`lineStyles`, `hatchPatterns`). Renderers and the saver read them through
// these helpers, which re-clean the list whenever the preferences object
// changes (load, edit, import), so untrusted or stale entries never reach a
// renderer.

import { state } from '../core/state.js';
import { cleanLineStyle, MAX_USER_LINE_STYLES, isBuiltinLineStyleId } from './line-styles.js';
import { syncUserHatchPatterns } from './hatch-registry.js';

let seenLineStyles;
let cleanLineStyles = [];

/** The user's line styles (clean copies; built-in ids are never user styles). */
export function userLineStyles() {
  const raw = state.preferences?.lineStyles;
  if (raw !== seenLineStyles) {
    seenLineStyles = raw;
    const ids = new Set();
    cleanLineStyles = (Array.isArray(raw) ? raw : []).slice(0, MAX_USER_LINE_STYLES)
      .map(cleanLineStyle)
      .filter(s => s && !isBuiltinLineStyleId(s.id) && !ids.has(s.id) && ids.add(s.id));
  }
  return cleanLineStyles;
}

/** Push the imported hatch patterns from preferences into the hatch registry. */
export function syncHatchPatternsFromPreferences() {
  syncUserHatchPatterns(state.preferences?.hatchPatterns);
}

/**
 * Give an annotation a line style (empty id: back to its plain border
 * style). A user style is also copied onto the markup (`lineStyleDef`), so it
 * keeps drawing if that style is later deleted; edits to the style still win
 * while it exists (resolveLineStyle).
 */
export function zetLijnstijl(ann, id) {
  if (!ann) return;
  if (!id || id === 'none' || id === 'mixed') {
    ann.lineStyleId = undefined;
    ann.lineStyleDef = undefined;
    return;
  }
  ann.lineStyleId = id;
  const user = isBuiltinLineStyleId(id) ? null : userLineStyles().find(s => s.id === id);
  if (user) ann.lineStyleDef = cleanLineStyle(user);
  else if (isBuiltinLineStyleId(id)) ann.lineStyleDef = undefined;
}
