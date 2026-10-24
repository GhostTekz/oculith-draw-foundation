// Store voor het "Zichtbaarheid Elementen"-paneel (V1 — uitsluitend annotaties).
//
// Doel: een Revit-achtig Visibility/Graphics-paneel, maar dan alléén voor de
// ANNOTATIE-SOORTEN die in het actieve document zitten. Per soort kan de
// gebruiker:
//   • de zichtbaarheid aan/uit zetten  (hiddenTypes)
//   • een "halftone"-override zetten: de soort dimmen met een instelbare
//     opacity-factor en optionele kleur-tint            (halftoneTypes)
//
// De renderer (annotations/rendering.js → drawAnnotation) raadpleegt deze store
// via de hieronder geëxporteerde helpers, zodat verborgen soorten worden
// overgeslagen en gehalftoneerde soorten met verlaagde opacity + tint tekenen.

import { createSignal } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';

// ── Panel-zichtbaarheid ──────────────────────────────────────────────────
const [panelVisible, setPanelVisible] = createSignal(false);

// ── Per-soort status ─────────────────────────────────────────────────────
// Set van annotatie-type-strings (ann.type) die volledig verborgen zijn.
const [hiddenTypes, setHiddenTypes] = createSignal(new Set());

// Map van type → { opacity: 0..1, color: string|null }. Aanwezig = halftone aan.
// opacity is de dim-factor (bv. 0.3), color is een optionele tint (null = geen).
const [halftoneTypes, setHalftoneTypes] = createSignal(new Map());

// ── Afgeleide lijst met soorten die in het actieve document voorkomen ────
// Elk item: { type, count }. Reactief via een teller die bij refresh oploopt.
const [typeSummary, setTypeSummary] = createSignal([]);

// Standaard dim-factor voor een nieuw ingeschakelde halftone.
const DEFAULT_HALFTONE_OPACITY = 0.35;

// Annotatie-"types" die geen echte gebruikers-annotaties zijn en niet in het
// paneel horen (interne markers / tool-defaults).
const _SKIP_TYPES = new Set(['__tool-defaults__']);

// Herbereken de lijst met annotatie-soorten uit doc.annotations (group-by type
// met tellers). Aanroepen na document open/wissel en na annotatie add/delete.
export function refreshElementTypes() {
  const doc = getActiveDocument();
  const anns = doc && Array.isArray(doc.annotations) ? doc.annotations : [];
  const counts = new Map();
  for (const a of anns) {
    if (!a || !a.type || _SKIP_TYPES.has(a.type)) continue;
    counts.set(a.type, (counts.get(a.type) || 0) + 1);
  }
  const list = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((x, y) => x.type.localeCompare(y.type));
  setTypeSummary(list);
}

// Herteken de annotatie-overlay (single of doorlopende weergave) na een wijziging.
function redraw() {
  // Lazy import om laad-cyclus met rendering.js te vermijden.
  import('../../annotations/rendering.js').then(m => {
    if (getActiveDocument()?.viewMode === 'continuous') {
      m.redrawContinuous();
    } else {
      m.redrawAnnotations();
    }
  }).catch(() => { /* renderer nog niet geladen */ });
}

// ── Zichtbaarheid aan/uit ────────────────────────────────────────────────
export function isTypeHidden(type) {
  return hiddenTypes().has(type);
}

export function toggleTypeHidden(type) {
  const next = new Set(hiddenTypes());
  if (next.has(type)) next.delete(type);
  else next.add(type);
  setHiddenTypes(next);
  redraw();
}

export function setTypeHidden(type, hidden) {
  const next = new Set(hiddenTypes());
  if (hidden) next.add(type);
  else next.delete(type);
  setHiddenTypes(next);
  redraw();
}

// ── Halftone (dimmen) + kleur-tint ───────────────────────────────────────
export function getHalftone(type) {
  return halftoneTypes().get(type) || null;
}

export function isTypeHalftoned(type) {
  return halftoneTypes().has(type);
}

export function toggleTypeHalftone(type) {
  const next = new Map(halftoneTypes());
  if (next.has(type)) {
    next.delete(type);
  } else {
    next.set(type, { opacity: DEFAULT_HALFTONE_OPACITY, color: null });
  }
  setHalftoneTypes(next);
  redraw();
}

// Zet/wijzig de tint-kleur van een gehalftoneerde soort. Schakelt halftone
// automatisch in als hij nog uit stond.
export function setHalftoneColor(type, color) {
  const next = new Map(halftoneTypes());
  const cur = next.get(type) || { opacity: DEFAULT_HALFTONE_OPACITY, color: null };
  next.set(type, { ...cur, color: color || null });
  setHalftoneTypes(next);
  redraw();
}

// Zet de dim-factor (0..1) van een gehalftoneerde soort.
export function setHalftoneOpacity(type, opacity) {
  const next = new Map(halftoneTypes());
  const cur = next.get(type) || { opacity: DEFAULT_HALFTONE_OPACITY, color: null };
  const clamped = Math.max(0.05, Math.min(1, Number(opacity) || DEFAULT_HALFTONE_OPACITY));
  next.set(type, { ...cur, opacity: clamped });
  setHalftoneTypes(next);
  redraw();
}

// Alles resetten (alle soorten weer zichtbaar, geen halftone).
export function resetElementVisibility() {
  setHiddenTypes(new Set());
  setHalftoneTypes(new Map());
  redraw();
}

// ── Panel toggle ─────────────────────────────────────────────────────────
export function toggleElementVisibilityPanel() {
  const willShow = !panelVisible();
  setPanelVisible(willShow);
  if (willShow) refreshElementTypes();
}

export {
  panelVisible, setPanelVisible,
  hiddenTypes, halftoneTypes,
  typeSummary,
  DEFAULT_HALFTONE_OPACITY,
};
