import { customTextColumnName } from './custom-text-column.js';
import { numberText } from './custom-number-column.js';

export const CHOICE_SCHEMA_VERSION = 1;
export const CHOICE_NUMERIC_SCHEMA_VERSION = 2;
export const CHOICE_OPTION_MAX = 48;
export const CHOICE_OPTIONS_MAX = 20;
export const CHOICE_JSON_MAX = 2048;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u;

function optionLabel(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value
      || value.length > CHOICE_OPTION_MAX || CONTROLS.test(value)) return '';
  return value;
}

/** Strict, bounded document schema. Unknown fields and duplicate labels fail closed. */
export function choiceColumn(value, textColumnName = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !((value.version === CHOICE_SCHEMA_VERSION
        && Object.keys(value).sort().join(',') === 'name,options,version')
        || (value.version === CHOICE_NUMERIC_SCHEMA_VERSION
        && Object.keys(value).sort().join(',') === 'name,numericValues,options,version'))) return null;
  const name = customTextColumnName(value.name);
  if (!name || name.toLocaleLowerCase() === customTextColumnName(textColumnName).toLocaleLowerCase()
      || !Array.isArray(value.options) || value.options.length < 1
      || value.options.length > CHOICE_OPTIONS_MAX) return null;
  const options = value.options.map(optionLabel);
  if (options.some(option => !option)
      || new Set(options.map(option => option.toLocaleLowerCase())).size !== options.length) return null;
  let numericValues;
  if (value.version === CHOICE_NUMERIC_SCHEMA_VERSION) {
    if (!Array.isArray(value.numericValues) || value.numericValues.length !== options.length) return null;
    numericValues = value.numericValues.map(entry => entry === null ? null : numberText(entry));
    if (numericValues.every(entry => entry === null)
        || value.numericValues.some((entry, index) => entry !== null
          && (typeof entry !== 'string' || !numericValues[index] || numericValues[index] !== entry))) return null;
  }
  const normalized = value.version === CHOICE_NUMERIC_SCHEMA_VERSION
    ? { version: CHOICE_NUMERIC_SCHEMA_VERSION, name, options, numericValues }
    : { version: CHOICE_SCHEMA_VERSION, name, options };
  return JSON.stringify(normalized).length <= CHOICE_JSON_MAX ? normalized : null;
}

/** One selected defined value, or blank. A loose source string is never exported. */
export function choiceValue(value, options) {
  const label = optionLabel(value);
  return label && Array.isArray(options) && options.includes(label) ? label : '';
}

/** Optional exact decimal attached to a defined Choice label. */
export function choiceNumericValue(value, definition) {
  const choice = choiceColumn(definition);
  if (choice?.version !== CHOICE_NUMERIC_SCHEMA_VERSION) return null;
  const label = choiceValue(value, choice.options);
  return label ? choice.numericValues[choice.options.indexOf(label)] : null;
}
