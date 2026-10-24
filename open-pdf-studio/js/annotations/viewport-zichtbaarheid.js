// Wanneer de benoemde viewports (scaleRegion) op het canvas staan.
//
// Een viewport is geen markering maar de schaal van een deel van de pagina.
// Hij wordt dus niet als opmaak getekend, niet afgedrukt en niet opgeslagen
// als annotatie (zie pdf/viewports-vp.js). Alleen terwijl een meet- of
// schaalgereedschap actief is, licht hij op (lichtblauw), zodat de gebruiker
// ziet welke schaal waar geldt. Puur, zonder app-state: view-filter-rules.js
// en de test gebruiken dezelfde regel.

/** Gereedschappen waarbij de viewports oplichten. */
export const VIEWPORT_ZICHTBAAR_TOOLS = Object.freeze(new Set([
  'measureDistance', 'measureArea', 'measurePerimeter', 'measureAngle',
  'count', 'addHole', 'calibrationPick', 'scaleMeasure',
  // "Add Viewport" zelf: de bestaande viewports blijven zichtbaar tijdens het tekenen.
  'scaleRegion',
]));

/**
 * Lichten de viewports op bij dit gereedschap?
 * @param {string|null|undefined} tool  state.currentTool
 */
export function viewportsZichtbaarBij(tool) {
  return typeof tool === 'string' && VIEWPORT_ZICHTBAAR_TOOLS.has(tool);
}
