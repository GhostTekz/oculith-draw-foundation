import { createSignal, createMemo } from 'solid-js';
import { getActiveDocument } from '../../core/state.js';

// --- Telcategorieën (per sessie; presets + vrij toe te voegen) ---
const DEFAULT_CATEGORIES = [
  { id: 'deuren',        name: 'Deuren',        color: '#e11d48', markerStyle: 'dot' },
  { id: 'ramen',         name: 'Ramen',         color: '#2563eb', markerStyle: 'dot' },
  { id: 'stopcontacten', name: 'Stopcontacten', color: '#16a34a', markerStyle: 'dot' },
];

const [categories, setCategories] = createSignal([...DEFAULT_CATEGORIES]);
const [activeCategoryId, setActiveCategoryId] = createSignal('deuren');

export const countCategories = categories;
export const activeCountCategoryId = activeCategoryId;
export const activeCountCategory = () => categories().find(c => c.id === activeCategoryId()) || categories()[0] || null;
export function setActiveCountCategory(id) { setActiveCategoryId(id); }

/**
 * The markup to save as a Tool Chest preset: a symbol count carries the name
 * of its count category (tool-preset-count.js), so the preset keeps counting
 * in that category; any other markup is returned as it is.
 */
export function countPresetSource(markup) {
  if (markup?.type !== 'count' || markup.markerStyle !== 'symbol') return markup;
  const category = categories().find(c => c.id === markup.categoryId);
  return category ? { ...markup, countCategory: category.name } : markup;
}

export function addCountCategory(name, color = '#e11d48', markerStyle = 'dot', symbolId) {
  const id = (name || 'cat').toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  setCategories([...categories(), { id, name: name || 'Categorie', color, markerStyle, symbolId }]);
  return id;
}

export function updateCountCategory(id, patch) {
  setCategories(categories().map(c => c.id === id ? { ...c, ...patch } : c));
}

/** Verwijderen geblokkeerd zolang er markeringen in deze categorie staan. */
export function removeCountCategory(id) {
  const doc = getActiveDocument();
  const inUse = (doc?.annotations || []).some(a => a.type === 'count' && a.categoryId === id);
  if (inUse) return false;
  setCategories(categories().filter(c => c.id !== id));
  if (activeCategoryId() === id) setActiveCategoryId(categories()[0]?.id || '');
  return true;
}

/** Volgnummer na het hoogste bestaande nummer in deze categorie.
 * Na undo van de laatste markering wordt dat nummer weer beschikbaar; een
 * eerder verwijderd of ingeladen gat mag geen dubbel nummer veroorzaken.
 */
export function nextCountNumber(categoryId) {
  const doc = getActiveDocument();
  let count = 0;
  let highest = 0;
  const used = new Set();
  for (const annotation of doc?.annotations || []) {
    if (annotation.type !== 'count' || annotation.categoryId !== categoryId) continue;
    count++;
    if (Number.isSafeInteger(annotation.number) && annotation.number > 0) {
      used.add(annotation.number);
      highest = Math.max(highest, annotation.number);
    }
  }
  const next = Math.max(count, highest) + 1;
  if (Number.isSafeInteger(next)) return next;
  // Een geïmporteerd extreem nummer kan de veilige integergrens raken.
  // Kies dan het eerste vrije positieve nummer, nog steeds zonder duplicaat.
  let firstFree = 1;
  while (used.has(firstFree)) firstFree++;
  return firstFree;
}

/** Reactieve telling per categorie, afgeleid van de annotaties van het actieve document. */
export const countTallies = createMemo(() => {
  const doc = getActiveDocument();
  const counts = (doc?.annotations || []).filter(a => a.type === 'count');
  const byCat = new Map();
  for (const a of counts) {
    const k = a.categoryId || '(geen)';
    byCat.set(k, (byCat.get(k) || 0) + 1);
  }
  const rows = categories().map(c => ({ ...c, count: byCat.get(c.id) || 0 }));
  if (byCat.has('(geen)')) {
    rows.push({ id: '(geen)', name: '(geen categorie)', color: '#888888', markerStyle: 'dot', count: byCat.get('(geen)') });
  }
  return rows;
});

export const countTotal = createMemo(() => countTallies().reduce((s, r) => s + r.count, 0));

/** CSV-regels voor de telling (gebruikt door de paneel-export). */
export function countCsvRows() {
  return countTallies().filter(r => r.count > 0).map(r => `Telling,"${r.name}",${r.count},stuks,`);
}

/** Add a category with a fixed id unless it exists (construction symbol counts). */
export function ensureCountCategory(category) {
  if (!category?.id || categories().some(c => c.id === category.id)) return;
  setCategories([...categories(), { markerStyle: 'dot', ...category }]);
}
