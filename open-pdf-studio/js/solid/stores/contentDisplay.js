// Document content display: the Dimmer (fades the PDF page toward white so
// markups stand out, 0-90 %) and Dark Mode for the document content (inverts
// the page, not the app chrome). Both are preferences and act only on the
// PDF raster canvases (#pdf-canvas, the continuous-view .pdf-canvas and its
// sharp overlay) through the --ocu-content-filter variable that
// styles/navigation-bar.css applies; the annotation canvases are untouched,
// so markups keep their full colour.

import { state } from '../../core/state.js';
import { contentFilterCss, clampDimmer, DIMMER_DEFAULT } from '../../ui/chrome/navigation-format.js';

export const isDimmerOn = () => !!state.preferences?.contentDimmer;
export const dimmerLevel = () => clampDimmer(state.preferences?.contentDimmerLevel ?? DIMMER_DEFAULT);
export const isDarkContentOn = () => !!state.preferences?.contentDarkMode;

async function persist() {
  try {
    const m = await import('../../core/preferences.js');
    m.savePreferences?.();
  } catch (_) { /* preferences unavailable (tests) */ }
}

function set(patch, { persist: save = true } = {}) {
  Object.assign(state.preferences, patch);
  applyContentFilter();
  if (save) persist();
}

export const setDimmer = (on, opts) => set({ contentDimmer: !!on }, opts);
export const toggleDimmer = (opts) => setDimmer(!isDimmerOn(), opts);
/** Level 0-0.9; a level above 0 also turns the dimmer on. */
export function setDimmerLevel(level, opts) {
  const v = clampDimmer(level);
  set(v > 0 ? { contentDimmerLevel: v, contentDimmer: true } : { contentDimmerLevel: v }, opts);
}
export const setDarkContent = (on, opts) => set({ contentDarkMode: !!on }, opts);
export const toggleDarkContent = (opts) => setDarkContent(!isDarkContentOn(), opts);

/** The current filter, as contentFilterCss computes it. */
export const contentFilter = () => contentFilterCss({
  dimmer: isDimmerOn(), level: dimmerLevel(), dark: isDarkContentOn(),
});

/** Write the filter to the --ocu-content-filter variable on <html>. */
export function applyContentFilter() {
  if (typeof document === 'undefined') return;
  document.documentElement?.style?.setProperty?.('--ocu-content-filter', contentFilter());
}
