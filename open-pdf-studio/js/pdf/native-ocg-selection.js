// Selected native PDF optional content belongs to an open document, never to
// the source file. PDF.js IDs for indirect OCGs are `12R` or `12R3`.
import { state } from '../core/state.js';
import { settleCadOperationsBeforeLayerChange } from './cad-ocg-coordination.js';

const selections = new WeakMap();
const selectionUpdates = new WeakMap();

export function parseNativeOcgRef(id) {
  if (typeof id !== 'string') return null;
  const match = /^([1-9][0-9]*)R([0-9]+)?$/.exec(id);
  if (!match) return null;
  const objectNumber = Number(match[1]);
  const generation = match[2] === undefined ? 0 : Number(match[2]);
  if (!Number.isSafeInteger(objectNumber) || objectNumber > 0xffffffff
      || !Number.isSafeInteger(generation) || generation > 0xffff) return null;
  return { objectNumber, generation };
}

export async function initializeNativeOcgSelection(doc) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc?.getOptionalContentConfig) return null;
  const config = await pdfDoc.getOptionalContentConfig();
  if (doc.pdfDoc !== pdfDoc) return null;
  const groups = new Map();
  for (const [id, group] of config || []) {
    const ref = parseNativeOcgRef(id);
    if (ref && !doc._annotatieLaagOcgIds?.has(id)) {
      groups.set(id, { ...ref, defaultVisible: group.visible !== false });
    }
  }
  // Re-reading the PDF.js configuration must not reset a user's selection.
  const prior = selections.get(doc);
  if (prior?.pdfDoc === pdfDoc) {
    for (const id of doc._annotatieLaagOcgIds || []) {
      prior.groups.delete(id);
      prior.overrides.delete(id);
    }
    return prior;
  }
  const entry = { pdfDoc, groups, overrides: new Map(), revision: 0 };
  selections.set(doc, entry);
  return entry;
}

export function nativeOcgSelectionForDocument(doc) {
  const entry = doc && selections.get(doc);
  if (!entry || entry.pdfDoc !== doc.pdfDoc) return { ocgVisibility: [], revision: 0 };
  const ocgVisibility = [...entry.overrides].map(([id, visible]) => {
    const ref = entry.groups.get(id);
    return { object_number: ref.objectNumber, generation: ref.generation, visible };
  }).sort((a, b) => a.object_number - b.object_number || a.generation - b.generation);
  return { ocgVisibility, revision: entry.revision };
}

export function nativeOcgHasGroups(doc) {
  const entry = doc && selections.get(doc);
  return !!entry && entry.pdfDoc === doc.pdfDoc && entry.groups.size > 0;
}

export function nativeOcgSelectionForPath(path) {
  const doc = state.documents.find(item => item.filePath === path);
  return nativeOcgSelectionForDocument(doc);
}

export async function nativeOcgPdfJsConfig(doc) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc?.getOptionalContentConfig) return null;
  const config = await pdfDoc.getOptionalContentConfig();
  if (doc.pdfDoc !== pdfDoc) throw new Error('PDF replaced while resolving optional content');
  const entry = selections.get(doc);
  if (entry?.pdfDoc === pdfDoc) {
    for (const [id, visible] of entry.overrides) config.setVisibility(id, visible);
  }
  return config;
}

// Programmatic API while Layers controls remain disabled. A future UI can
// call this only after the remaining PDF.js/export routes are validated.
async function applyNativeOcgVisibility(doc, id, visible, pdfDoc) {
  if (doc.pdfDoc !== pdfDoc) throw new Error('PDF replaced during layer selection');
  const entry = await initializeNativeOcgSelection(doc);
  if (entry?.pdfDoc !== pdfDoc) throw new Error('PDF replaced during layer selection');
  const group = entry?.groups.get(id);
  if (!group || typeof visible !== 'boolean') throw new Error('Unknown native OCG group or visibility');
  const before = entry.overrides.get(id) ?? group.defaultVisible;
  if (before === visible) return nativeOcgSelectionForDocument(doc);
  const [bitmaps, tiles, progressive, orchestrator, thumbnails, renderer, layers] = await Promise.all([
    import('./page-bitmap-cache.js'), import('./tile-cache.js'),
    import('./progressive-render.js'), import('./bitmap-orchestrator.js'),
    import('../ui/panels/left-panel.js'),
    import('./renderer.js'),
    import('../ui/panels/layers.js'),
  ]);
  const finishLayerChange = await settleCadOperationsBeforeLayerChange(doc);
  try {
    if (doc.pdfDoc !== pdfDoc) throw new Error('PDF replaced during layer selection');
    if (visible === group.defaultVisible) entry.overrides.delete(id);
    else entry.overrides.set(id, visible);
    entry.revision++;
    bitmaps.invalidateDocumentBitmaps(doc.filePath);
    tiles.tileCacheClearForFile(doc.filePath);
    progressive.cancelProgressiveRenderForFile(doc.filePath);
    orchestrator.cancelBitmapRendersForFile(doc.filePath);
    thumbnails.invalidateDocumentThumbnails(doc);
    renderer.clearBitmapJSCacheForFile(doc.filePath);
    renderer.clearLowResCache();
  } finally {
    finishLayerChange();
  }
  if (state.documents[state.activeDocumentIndex] === doc && typeof document !== 'undefined') {
    await layers.updateLayersList();
    if (doc.viewMode === 'continuous') await renderer.renderContinuous();
    else await renderer.renderPage(doc.currentPage);
  }
  return nativeOcgSelectionForDocument(doc);
}

export function setNativeOcgVisibility(doc, id, visible) {
  if (!doc || typeof doc !== 'object') return Promise.reject(new Error('Missing document'));
  const pdfDoc = doc.pdfDoc;
  const previous = selectionUpdates.get(doc) || Promise.resolve();
  const update = previous.catch(() => {}).then(() => applyNativeOcgVisibility(doc, id, visible, pdfDoc));
  selectionUpdates.set(doc, update);
  update.finally(() => {
    if (selectionUpdates.get(doc) === update) selectionUpdates.delete(doc);
  }).catch(() => {});
  return update;
}
