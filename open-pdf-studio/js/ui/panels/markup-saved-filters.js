import { normalizeColumnFilters } from './markup-column-filter.js';

export const savedFiltersStorageKey = 'ocudraw.markups.savedFilters.v1';

// A status key: the default set's, or a document's own status (lower case,
// one line, up to 32 characters; markup-status.js).
const validStatus = status => typeof status === 'string' && status.length <= 32
  && /^[\p{L}\p{N}][\p{L}\p{N} _.\-/&]*$/u.test(status) && status === status.toLocaleLowerCase();

export function normalizeSavedFilters(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') return [];
    const name = entry.name.trim();
    const key = name.toLowerCase();
    if (!name || name.length > 64 || seen.has(key)) return [];
    seen.add(key);
    return [{
      name,
      searchQuery: typeof entry.searchQuery === 'string' ? entry.searchQuery : '',
      filterMode: entry.filterMode === 'current' ? 'current' : 'all',
      hiddenStatuses: Array.isArray(entry.hiddenStatuses)
        ? [...new Set(entry.hiddenStatuses.filter(validStatus))] : [],
      // Column header filters; absent in filters saved before they existed.
      ...(Object.keys(normalizeColumnFilters(entry.columnFilters)).length
        ? { columnFilters: normalizeColumnFilters(entry.columnFilters) } : {}),
    }];
  });
}

export function readSavedFilters(storage) {
  try { return normalizeSavedFilters(JSON.parse((storage ?? globalThis.localStorage)?.getItem(savedFiltersStorageKey) || '[]')); }
  catch { return []; }
}

export function writeSavedFilters(filters, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    target?.setItem(savedFiltersStorageKey, JSON.stringify(filters));
    return !!target;
  } catch { return false; }
}

export function addSavedFilter(filters, name, state) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > 64) return { error: 'Enter a name of up to 64 characters.' };
  if (filters.some(filter => filter.name.toLowerCase() === trimmed.toLowerCase())) {
    return { error: 'That filter name already exists.' };
  }
  const [entry] = normalizeSavedFilters([{ ...state, name: trimmed }]);
  return { filters: [...filters, entry] };
}
