import { customTextColumnName } from './custom-text-column.js';
import { numberColumn, numberText, numberValue } from './custom-number-column.js';
import { choiceColumn, choiceNumericValue, CHOICE_NUMERIC_SCHEMA_VERSION } from './custom-choice-column.js';

export const FORMULA_SCHEMA_VERSION = 1;
export const FORMULA_CHOICE_SCHEMA_VERSION = 2;
export const FORMULA_SECOND_NUMBER_SCHEMA_VERSION = 3;
export const FORMULA_JSON_MAX = 384;
const sameName = (a, b) => !!a && !!b && a.toLocaleLowerCase() === b.toLocaleLowerCase();
const SCALE = 1_000_000n;
const RESULT_LIMIT = 1_000_000_000n * SCALE;

/** A single affine formula over Number or a numerically mapped Choice. */
export function formulaColumn(value, numberDefinition, textName = '', choiceName = '',
  checkmarkName = '', choiceDefinition = null, secondNumberDefinition = null) {
  const number = numberColumn(numberDefinition);
  const secondNumber = numberColumn(secondNumberDefinition);
  const choice = choiceColumn(choiceDefinition);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'multiplier,name,offset,source,version'
      || !((value.version === FORMULA_SCHEMA_VERSION && value.source === 'customNumber' && number)
        || (value.version === FORMULA_CHOICE_SCHEMA_VERSION && value.source === 'customChoice'
          && choice?.version === CHOICE_NUMERIC_SCHEMA_VERSION)
        || (value.version === FORMULA_SECOND_NUMBER_SCHEMA_VERSION
          && value.source === 'customNumber2' && secondNumber))) return null;
  const name = customTextColumnName(value.name);
  if (!name || [number?.name, secondNumber?.name, choice?.name, textName, choiceName, checkmarkName]
    .some(other => sameName(name, other))) return null;
  if (typeof value.multiplier !== 'string' || typeof value.offset !== 'string'
      || numberText(value.multiplier) !== value.multiplier
      || numberText(value.offset) !== value.offset) return null;
  const normalized = { version: value.version, name, source: value.source,
    multiplier: value.multiplier, offset: value.offset };
  return JSON.stringify(normalized).length <= FORMULA_JSON_MAX ? normalized : null;
}

/** Select the document-backed Number value named by a validated Formula. */
export function formulaNumberSourceValue(annotation, definition) {
  return definition?.source === 'customNumber2'
    ? annotation?.markupNumberValue2 : annotation?.markupNumberValue;
}

function scaledDecimal(value) {
  if (numberValue(value) === null) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/u.exec(String(value));
  if (!match) return null;
  const magnitude = BigInt(match[2]) * SCALE + BigInt((match[3] || '').padEnd(6, '0') || '0');
  return match[1] ? -magnitude : magnitude;
}

/** Exact six-place result for display and sorting; round midpoint away from zero. */
export function formulaScaledValue(value, definition, choiceLabel = '', choiceDefinition = null) {
  if (!definition || !['customNumber', 'customNumber2', 'customChoice'].includes(definition.source)) return null;
  const source = definition.source === 'customChoice'
    ? choiceNumericValue(choiceLabel, choiceDefinition) : value;
  const input = scaledDecimal(source);
  const multiplier = scaledDecimal(definition.multiplier);
  const offset = scaledDecimal(definition.offset);
  if (input === null || multiplier === null || offset === null) return null;
  const product = input * multiplier + offset * SCALE;
  const magnitude = product < 0n ? -product : product;
  const rounded = magnitude / SCALE + (magnitude % SCALE * 2n >= SCALE ? 1n : 0n);
  if (rounded >= RESULT_LIMIT) return null;
  return product < 0n ? -rounded : rounded;
}

/** Numeric projection for consumers that do not need exact decimal rendering. */
export function formulaValue(value, definition, choiceLabel = '', choiceDefinition = null) {
  const text = formulaText(value, definition, choiceLabel, choiceDefinition);
  return text === '' ? null : Number(text);
}

export function formulaText(value, definition, choiceLabel = '', choiceDefinition = null) {
  const scaled = formulaScaledValue(value, definition, choiceLabel, choiceDefinition);
  if (scaled === null) return '';
  const magnitude = scaled < 0n ? -scaled : scaled;
  const whole = magnitude / SCALE;
  const fraction = String(magnitude % SCALE).padStart(6, '0').replace(/0+$/u, '');
  return `${scaled < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
