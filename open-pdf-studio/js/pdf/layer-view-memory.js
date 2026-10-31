// Remembered PDF layer views. The visibility a user picks in the Layers panel
// is a view of the drawing, not a change to it: it is kept by the app, per
// document, and never written into the PDF unless the user explicitly saves
// it as the PDF default (native-ocg-selection.js saveNativeOcgSelectionAsDefault).
//
// A view is keyed by the file path, and each remembered layer carries its
// name, so a view is only restored onto layers that still have the same
// reference and name. Anything that does not match
// is dropped silently: a stale view must never hide a layer by accident.

export const LAYER_VIEW_STORAGE_KEY = 'oculith.pdfLayerViews.v1';
export const LAYER_VIEW_LIMIT = 200;

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

let storage = defaultStorage();

/** Tests replace the storage (any object with getItem/setItem). */
export function setLayerViewStorage(next) {
  storage = next;
}

function readAll() {
  try {
    const raw = storage?.getItem(LAYER_VIEW_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    storage?.setItem(LAYER_VIEW_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // A full or blocked storage only loses the remembered view.
  }
}

/**
 * The key for a document, or null when it has no stable identity. The path
 * alone: a save may rewrite the PDF's identifier, and a new revision saved
 * over the same sheet keeps its view where its layers still match.
 */
export function layerViewKey(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  return filePath;
}

/**
 * Remember a document's layer view.
 * @param {string|null} key  layerViewKey()
 * @param {{id: string, name: string, visible: boolean}[]} layers  only the
 *   layers whose visibility differs from the PDF default; empty forgets the view
 */
export function rememberLayerView(key, layers, now = Date.now()) {
  if (!key) return;
  const all = readAll();
  const clean = (layers || []).filter(layer => layer && typeof layer.id === 'string'
    && typeof layer.visible === 'boolean').map(layer => ({
    id: layer.id, name: typeof layer.name === 'string' ? layer.name : '', visible: layer.visible,
  }));
  if (!clean.length) delete all[key];
  else all[key] = { layers: clean, at: now };
  const keys = Object.keys(all);
  if (keys.length > LAYER_VIEW_LIMIT) {
    keys.sort((a, b) => (all[a]?.at || 0) - (all[b]?.at || 0));
    for (const old of keys.slice(0, keys.length - LAYER_VIEW_LIMIT)) delete all[old];
  }
  writeAll(all);
}

/**
 * The remembered overrides that still apply to this document.
 * @param {string|null} key
 * @param {Map<string, {name?: string, defaultVisible: boolean}>} groups  the
 *   document's native layers
 * @returns {Map<string, boolean>} id → visible, only real differences
 */
export function recallLayerView(key, groups) {
  const result = new Map();
  if (!key || !groups) return result;
  const entry = readAll()[key];
  if (!entry || !Array.isArray(entry.layers)) return result;
  for (const layer of entry.layers) {
    const group = groups.get(layer?.id);
    if (!group || typeof layer.visible !== 'boolean') continue;
    if ((group.name || '') !== (layer.name || '')) continue;
    if (group.defaultVisible !== layer.visible) result.set(layer.id, layer.visible);
  }
  return result;
}
