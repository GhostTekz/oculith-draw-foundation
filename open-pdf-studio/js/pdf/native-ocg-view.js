// Pure layer-view arithmetic for native PDF layers (native-ocg-selection.js).
// `groups` maps a PDF.js OCG id to { defaultVisible, name }; a view is kept as
// overrides: only the layers whose visibility differs from the PDF default.

/** Overrides for the wanted visibility of some layers, on top of `current`. */
export function withVisibility(groups, current, changes) {
  const next = new Map(current);
  for (const [id, visible] of changes instanceof Map ? changes : Object.entries(changes || {})) {
    const group = groups.get(id);
    if (!group) throw new Error(`Unknown PDF layer: ${id}`);
    if (typeof visible !== 'boolean') throw new Error('Layer visibility must be true or false');
    if (visible === group.defaultVisible) next.delete(id);
    else next.set(id, visible);
  }
  return next;
}

/** Only `id` shown (with `alsoShown`, e.g. the layers of the same heading). */
export function soloOverrides(groups, id, alsoShown = []) {
  if (!groups.has(id)) throw new Error(`Unknown PDF layer: ${id}`);
  const shown = new Set([id, ...alsoShown]);
  const changes = new Map();
  for (const key of groups.keys()) changes.set(key, shown.has(key));
  return withVisibility(groups, new Map(), changes);
}

/** Every layer (or every layer in `ids`) shown or hidden. */
export function allOverrides(groups, current, visible, ids = null) {
  const changes = new Map();
  for (const key of ids || groups.keys()) if (groups.has(key)) changes.set(key, visible);
  return withVisibility(groups, current, changes);
}

export function sameOverrides(a, b) {
  if (a.size !== b.size) return false;
  for (const [id, visible] of a) if (b.get(id) !== visible) return false;
  return true;
}

/** Panel rows: each layer with its default and current visibility. */
export function layerStates(groups, overrides) {
  return [...groups].map(([id, group]) => ({
    id,
    name: group.name || '',
    defaultVisible: group.defaultVisible,
    visible: overrides.has(id) ? overrides.get(id) : group.defaultVisible,
  }));
}

/** Case-insensitive name filter for the panel (empty filter keeps all). */
export function layerNameMatches(name, filter) {
  const wanted = String(filter || '').trim().toLocaleLowerCase();
  if (!wanted) return true;
  return String(name || '').toLocaleLowerCase().includes(wanted);
}

/**
 * Layers panel rows (lagen-lijst.js lines) with what the controls need: whether a layer can be switched
 * (an ordinary drawing layer with an object reference, in a PDF whose view
 * PDFium can show: `support` from native-ocg-support.js), its PDF default,
 * and for a heading the layers below it.
 */
export function layerPanelRows(regels, states, support = null) {
  const byId = new Map(states.map(state => [state.id, state]));
  const switchable = support?.supported !== false;
  const rows = regels.map(regel => {
    if (regel.kop) return { ...regel, children: [] };
    const state = byId.get(regel.id);
    return { ...regel, toggleable: !!state && switchable, defaultVisible: state ? state.defaultVisible : regel.visible,
      visible: state ? state.visible : regel.visible };
  });
  rows.forEach((row, index) => {
    if (!row.kop) return;
    for (let i = index + 1; i < rows.length && rows[i].depth > row.depth; i++) {
      if (!rows[i].kop && rows[i].toggleable) row.children.push(rows[i].id);
    }
  });
  return rows;
}

/** Raised when the PDF's layers cannot be shown switched (native-ocg-support.js). */
export class OcgViewUnsupported extends Error {
  constructor(reason) {
    super(`PDF layers cannot be switched in this document (${reason})`);
    this.name = 'OcgViewUnsupported';
    this.reason = reason;
  }
}

/**
 * Refuse a layer view `next` (overrides) the support cannot show; back to
 * the default (no overrides) always passes, as does an unknown support.
 */
export function assertViewSupported(next, support) {
  if (next?.size && support && support.supported === false) throw new OcgViewUnsupported(support.reason);
}
