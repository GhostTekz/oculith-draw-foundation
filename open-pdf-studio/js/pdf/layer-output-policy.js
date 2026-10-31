// What each output route does with a PDF layer view that differs from the
// PDF's default layer visibility (docs/foundation/PDF-LAYERS.md has the same
// table for readers). Display and every output must agree on what is shown:
// a route either draws the selected layers, refuses with a choice, or is
// unaffected by design (it never draws page content or deliberately keeps the
// whole document).
//
//   honours     uses the selected view
//   refuses     cannot use it yet; the user picks "Reset layers and continue"
//               or, where offered, "Export as raster"
//   unaffected  does not depend on the view by design

export const LAYER_ROUTES = Object.freeze({
  display: { behaviour: 'honours' },
  thumbnails: { behaviour: 'honours' },
  print: { behaviour: 'honours' },
  'print-to-pdf': { behaviour: 'honours' },
  'image-export': { behaviour: 'honours' },
  'raster-pdf-export': { behaviour: 'honours' },
  screenshot: { behaviour: 'honours' },
  'snap-geometry': { behaviour: 'honours' },
  'visual-search': { behaviour: 'honours' },
  save: { behaviour: 'unaffected' },
  flatten: { behaviour: 'unaffected' },
  'text-search': { behaviour: 'unaffected' },
  compare: { behaviour: 'unaffected' },
  'office-export': { behaviour: 'unaffected' },
  'batch-split': { behaviour: 'unaffected' },
  'extract-pages': { behaviour: 'refuses', raster: true },
  'pdfx-export': { behaviour: 'refuses', raster: true },
  'cad-export': { behaviour: 'refuses', raster: false },
});

/**
 * The decision for one route.
 * @param {string} route  a LAYER_ROUTES key
 * @param {boolean} selectionDiffers  the document's layer view differs from
 *   the PDF default
 * @returns {{ action: 'continue' } | { action: 'ask', options: string[] }}
 */
export function layerRouteDecision(route, selectionDiffers) {
  const entry = LAYER_ROUTES[route];
  if (!entry) throw new Error(`Unknown output route: ${route}`);
  if (!selectionDiffers || entry.behaviour !== 'refuses') return { action: 'continue' };
  return { action: 'ask', options: entry.raster ? ['reset', 'raster', 'cancel'] : ['reset', 'cancel'] };
}

/**
 * Ask the user what to do before a refusing route runs with a changed view.
 * Resolves to 'continue' (nothing to ask, or the layers were reset),
 * 'raster' (the caller exports a raster copy instead) or 'cancel'.
 * `deps` lets tests replace the dialog and the reset.
 */
export async function confirmLayerRoute(doc, route, deps = {}) {
  const selection = deps.selection || (await import('./native-ocg-selection.js'));
  const differs = selection.nativeOcgSelectionForDocument(doc).ocgVisibility.length > 0;
  const decision = layerRouteDecision(route, differs);
  if (decision.action === 'continue') return 'continue';
  const ask = deps.ask || askLayerChoice;
  const choice = await ask({ route, options: decision.options });
  if (choice === 'reset') {
    await selection.resetNativeOcgSelection(doc);
    return selection.nativeOcgSelectionForDocument(doc).ocgVisibility.length ? 'cancel' : 'continue';
  }
  if (choice === 'raster' && decision.options.includes('raster')) return 'raster';
  return 'cancel';
}

function askLayerChoice({ route, options }) {
  return import('../solid/stores/dialogStore.js').then(({ openDialog }) => new Promise((resolve) => {
    openDialog('layer-selection', { route, options, resolve });
  }));
}
