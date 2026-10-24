import { customTextColumnName } from './custom-text-column.js';

export const CHECKMARK_SCHEMA_VERSION = 1;
export const CHECKMARK_JSON_MAX = 256;
export const CHECKMARK_VALUE_MAX = 9;
const sameName = (a, b) => !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** One named Checkmark column, with no implicit default or extra fields. */
export function checkmarkColumn(value, textName = '', choiceName = '', numberName = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'name,version'
      || value.version !== CHECKMARK_SCHEMA_VERSION) return null;
  const name = customTextColumnName(value.name);
  if (!name || [textName, choiceName, numberName].some(other =>
    sameName(name, customTextColumnName(other)))) return null;
  const normalized = { version: CHECKMARK_SCHEMA_VERSION, name };
  return JSON.stringify(normalized).length <= CHECKMARK_JSON_MAX ? normalized : null;
}

/** null means unanswered; both choices are explicit markup decisions. */
export function checkmarkValue(value) {
  return value === 'checked' || value === 'unchecked' ? value : null;
}

export function checkmarkText(value) {
  const state = checkmarkValue(value);
  return state ? state[0].toUpperCase() + state.slice(1) : '';
}

export function checkmarkRank(value) {
  return value === 'unchecked' ? 1 : value === 'checked' ? 2 : 0;
}
