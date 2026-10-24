// Registration + persistence for downloaded steel-section catalogs.
//
// A downloaded `steel-sections` catalog (online symbol library) becomes a set
// of parametric templates in the shared registry (one per profile family) and
// is persisted in preferences (state.preferences.steelSectionCatalogs) so the
// templates come back after a restart — the palette group itself persists via
// the existing custom-groups mechanism (customSymbolGroups).
//
// The pure conversion lives in steel-catalog.js (node-testable); this module
// only adds registry + preferences glue.

import { registerTemplate, unregisterTemplate } from './registry.js';
import { steelCatalogTemplates, steelTemplateId } from './steel-catalog.js';
import { state } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';

/**
 * Register all templates of a steel catalog; persists the catalog so it can
 * be re-registered at the next start. Idempotent (re-registering replaces).
 */
export function registerSteelCatalog(collectionId, catalog, { persist = true } = {}) {
  const templates = steelCatalogTemplates(collectionId, catalog);
  for (const t of templates) registerTemplate(t);
  if (persist) {
    const all = { ...(state.preferences.steelSectionCatalogs || {}) };
    all[collectionId] = catalog;
    state.preferences.steelSectionCatalogs = all;
    savePreferences();
  }
  return templates;
}

/** Re-register all persisted catalogs; call once at startup (after loadPreferences). */
export function initSteelCatalogs() {
  const all = state.preferences.steelSectionCatalogs || {};
  for (const [collectionId, catalog] of Object.entries(all)) {
    try {
      registerSteelCatalog(collectionId, catalog, { persist: false });
    } catch (e) {
      console.warn(`Staalcatalogus ${collectionId} niet geregistreerd:`, e);
    }
  }
}

/**
 * Remove a persisted catalog + its registered templates. Called when the
 * user removes the downloaded palette group (symbolStore.removeCustomGroup).
 * No-op for collections without a steel catalog.
 */
export function removeSteelCatalog(collectionId) {
  const all = state.preferences.steelSectionCatalogs || {};
  const catalog = all[collectionId];
  if (!catalog) return;
  for (const f of catalog.families || []) {
    unregisterTemplate(steelTemplateId(collectionId, f.id));
  }
  const next = { ...all };
  delete next[collectionId];
  state.preferences.steelSectionCatalogs = next;
  savePreferences();
}
