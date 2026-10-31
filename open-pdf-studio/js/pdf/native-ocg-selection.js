// Selected native PDF optional content belongs to an open document, never to
// the source file. PDF.js IDs for indirect OCGs are `12R` or `12R3`.
import { state } from '../core/state.js';
import { settleCadOperationsBeforeLayerChange } from './cad-ocg-coordination.js';
import { withVisibility, soloOverrides, allOverrides, sameOverrides, layerStates, assertViewSupported } from './native-ocg-view.js';
import { layerViewKey, rememberLayerView, recallLayerView } from './layer-view-memory.js';

const selections = new WeakMap();
const selectionUpdates = new WeakMap();
const renderSupport = new WeakMap(); // document -> { pdfDoc, promise }

/**
 * Whether PDFium can show this document with a changed layer view:
 * `{ supported, reason? }`, or null when the structure could not be read
 * (switching is then allowed, as before). Read once per opened PDF.
 */
export function nativeOcgRenderSupport(doc) {
  const pdfDoc = doc?.pdfDoc;
  if (!pdfDoc) return Promise.resolve(null);
  const known = renderSupport.get(doc);
  if (known?.pdfDoc === pdfDoc) return known.promise;
  const promise = (async () => {
    try {
      const { pdfLibCatalog } = await import('./loader.js');
      return (await pdfLibCatalog(doc))?.ocgRenderSupport || null;
    } catch {
      return null;
    }
  })();
  renderSupport.set(doc, { pdfDoc, promise });
  return promise;
}


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
      groups.set(id, { ...ref, defaultVisible: group.visible !== false,
        name: typeof group.name === 'string' ? group.name : '' });
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
  // pdfjsDefaults: layers whose default this app wrote into the file after
  // PDF.js read it (saveNativeOcgSelectionAsDefault); PDFium reads the file.
  const entry = { pdfDoc, groups, overrides: new Map(), pdfjsDefaults: new Map(), revision: 0,
    key: layerViewKey(doc.filePath) };
  selections.set(doc, entry);
  // A view the user left on this document comes back when it is reopened
  // (not when PDFium cannot show it: the update below then refuses).
  const remembered = recallLayerView(entry.key, groups);
  if (remembered.size) {
    queueNativeOcgUpdate(doc, () => remembered, { remember: false }).catch(() => {});
  }
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
    for (const [id, visible] of entry.pdfjsDefaults) config.setVisibility(id, visible);
    for (const [id, visible] of entry.overrides) config.setVisibility(id, visible);
  }
  return config;
}

/** True when the document's layer view differs from the PDF default. */
export function nativeOcgSelectionDiffers(doc) {
  return nativeOcgSelectionForDocument(doc).ocgVisibility.length > 0;
}

/** Each native layer with its default and current visibility. */
export function nativeOcgLayerStates(doc) {
  const entry = doc && selections.get(doc);
  if (!entry || entry.pdfDoc !== doc.pdfDoc) return [];
  return layerStates(entry.groups, entry.overrides);
}

// Every change goes through one queue per document, so quick clicks apply in
// order and each change invalidates the caches once.
async function applyNativeOcgSelection(doc, target, pdfDoc, { remember = true } = {}) {
  if (doc.pdfDoc !== pdfDoc) throw new Error('PDF replaced during layer selection');
  const entry = await initializeNativeOcgSelection(doc);
  if (entry?.pdfDoc !== pdfDoc) throw new Error('PDF replaced during layer selection');
  const next = target(entry);
  if (sameOverrides(next, entry.overrides)) return nativeOcgSelectionForDocument(doc);
  // PDFium renders a changed view through a copy it cannot build for some
  // PDFs; refuse before any render fails. Back to the default always works.
  if (next.size) {
    const support = await nativeOcgRenderSupport(doc);
    if (doc.pdfDoc !== pdfDoc) throw new Error('PDF replaced during layer selection');
    assertViewSupported(next, support);
  }
  const [bitmaps, tiles, progressive, orchestrator, thumbnails, renderer, layers, snap] = await Promise.all([
    import('./page-bitmap-cache.js'), import('./tile-cache.js'),
    import('./progressive-render.js'), import('./bitmap-orchestrator.js'),
    import('../ui/panels/left-panel.js'),
    import('./renderer.js'),
    import('../ui/panels/layers.js'),
    import('../tools/pdf-snap-extractor.js'),
  ]);
  const finishLayerChange = await settleCadOperationsBeforeLayerChange(doc);
  try {
    if (doc.pdfDoc !== pdfDoc) throw new Error('PDF replaced during layer selection');
    entry.overrides = next;
    entry.revision++;
    bitmaps.invalidateDocumentBitmaps(doc.filePath);
    tiles.tileCacheClearForFile(doc.filePath);
    progressive.cancelProgressiveRenderForFile(doc.filePath);
    orchestrator.cancelBitmapRendersForFile(doc.filePath);
    thumbnails.invalidateDocumentThumbnails(doc);
    renderer.clearBitmapJSCacheForFile(doc.filePath);
    renderer.clearLowResCache();
    // Snapping and measuring follow the visible layers (pdf-snap-extractor.js).
    if (state.documents[state.activeDocumentIndex] === doc) snap.clearPdfVectorCache();
  } finally {
    finishLayerChange();
  }
  if (remember) {
    rememberLayerView(entry.key, [...entry.overrides].map(([id, visible]) => ({
      id, name: entry.groups.get(id)?.name || '', visible,
    })));
  }
  if (state.documents[state.activeDocumentIndex] === doc && typeof document !== 'undefined') {
    await layers.updateLayersList();
    if (doc.viewMode === 'continuous') await renderer.renderContinuous();
    else await renderer.renderPage(doc.currentPage);
  }
  return nativeOcgSelectionForDocument(doc);
}

function queueNativeOcgUpdate(doc, target, options) {
  if (!doc || typeof doc !== 'object') return Promise.reject(new Error('Missing document'));
  const pdfDoc = doc.pdfDoc;
  const previous = selectionUpdates.get(doc) || Promise.resolve();
  const update = previous.catch(() => {}).then(() => applyNativeOcgSelection(doc, target, pdfDoc, options));
  selectionUpdates.set(doc, update);
  update.finally(() => {
    if (selectionUpdates.get(doc) === update) selectionUpdates.delete(doc);
  }).catch(() => {});
  return update;
}

export function setNativeOcgVisibility(doc, id, visible) {
  return queueNativeOcgUpdate(doc, entry => withVisibility(entry.groups, entry.overrides, { [id]: visible }));
}

/** Several layers at once: a Map or object of id → visible. */
export function setNativeOcgVisibilities(doc, changes) {
  return queueNativeOcgUpdate(doc, entry => withVisibility(entry.groups, entry.overrides, changes));
}

/** Show only `id` (and `alsoShown`), hide every other drawing layer. */
export function soloNativeOcg(doc, id, alsoShown = []) {
  return queueNativeOcgUpdate(doc, entry => soloOverrides(entry.groups, id, alsoShown));
}

/** Show or hide every drawing layer, or only those in `ids`. */
export function setAllNativeOcg(doc, visible, ids = null) {
  return queueNativeOcgUpdate(doc, entry => allOverrides(entry.groups, entry.overrides, visible, ids));
}

/** Back to the PDF's default layer visibility (and forget the saved view). */
export function resetNativeOcgSelection(doc) {
  return queueNativeOcgUpdate(doc, () => new Map());
}

/**
 * Write the current view into the PDF as its default layer visibility, with
 * an ordinary save of the document. Resolves to true when it was saved.
 */
export async function saveNativeOcgSelectionAsDefault(doc) {
  const written = nativeOcgSelectionForDocument(doc).ocgVisibility;
  if (!written.length) return false;
  // An untitled document goes through Save As, which writes no layer default.
  if (!doc.filePath || doc.isUntitled) return false;
  const pdfDoc = doc.pdfDoc;
  const { savePDF } = await import('./saver.js');
  const saved = await savePDF(null, { nativeOcgDefault: written }, doc);
  if (!saved) return false;
  if (doc.pdfDoc !== pdfDoc) {
    // The document was reloaded from the saved bytes: its defaults are the
    // written view already.
    const entry = selections.get(doc);
    if (entry) rememberLayerView(entry.key, []);
    return true;
  }
  await queueNativeOcgUpdate(doc, (entry) => {
    for (const item of written) {
      const id = [...entry.groups].find(([, g]) => g.objectNumber === item.object_number
        && g.generation === item.generation)?.[0];
      if (!id) continue;
      entry.groups.get(id).defaultVisible = item.visible;
      entry.pdfjsDefaults.set(id, item.visible);
    }
    return withVisibility(entry.groups, new Map(), new Map([...entry.overrides].filter(([id, visible]) =>
      entry.groups.get(id).defaultVisible !== visible)));
  });
  return true;
}
