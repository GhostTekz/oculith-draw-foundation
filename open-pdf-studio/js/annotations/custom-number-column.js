import { customTextColumnName } from './custom-text-column.js';

export const NUMBER_SCHEMA_VERSION = 1;
export const NUMBER_JSON_MAX = 256;
export const NUMBER_TEXT_MAX = 17;
const DECIMAL = /^-?(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/u;

const sameName = (a, b) => !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** One bounded, document-scoped Number column. No formatting or expressions. */
export function numberColumn(value, textName = '', choiceName = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'name,version'
      || value.version !== NUMBER_SCHEMA_VERSION) return null;
  const name = customTextColumnName(value.name);
  if (!name || sameName(name, customTextColumnName(textName))
      || sameName(name, customTextColumnName(choiceName))) return null;
  const normalized = { version: NUMBER_SCHEMA_VERSION, name };
  return JSON.stringify(normalized).length <= NUMBER_JSON_MAX ? normalized : null;
}

/** A finite plain decimal, or null for an absent/invalid value. */
export function numberValue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  if (text.length > NUMBER_TEXT_MAX || !DECIMAL.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? (number === 0 ? 0 : number) : null;
}

export function numberText(value) {
  const number = numberValue(value);
  return number === null ? '' : String(number);
}
