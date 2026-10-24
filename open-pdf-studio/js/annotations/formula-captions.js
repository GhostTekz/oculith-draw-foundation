// Formula columns with expressions and Custom Captions (plan-review takeoff
// pricing). Pure: no state, no DOM; the Markups List, the canvas and the PDF
// save path pass the document they work on.
//
// A Formula column is { name, expression, unit, decimals, lengthUnit }:
//   expression  + - * / (also × ÷ −), parentheses, decimal constants and
//               references. A reference is {Name} or [Name] (any column name,
//               spaces and slashes allowed) or a bare word (letters, digits, _).
//   references  Number and numerically mapped Choice columns, the bounded
//               (legacy) Formula column, earlier Formula columns, and the
//               measurement values Length, Area, Volume, Count, Depth and
//               Wall Area (polylength x height).
//   lengthUnit  '' keeps the measurement's own unit; mm/cm/m/in/ft converts
//               lengths (areas squared, volumes cubed) before the arithmetic.
//   unit        the result's label (e.g. '$' or 'm²'), decimals 0-6.
//
// A physical measurement value needs an explicit calibration (K-004): an
// uncalibrated markup gives a blank result with the 'uncalibrated' warning,
// never page units dressed up as a price.
//
// A Custom Caption is a template such as '{Subject} {Area} {Cost}' per markup
// type (document-wide, "per tool") or per markup (its own template wins).

import { customTextColumnName } from './custom-text-column.js';
import { numberColumn, numberValue, numberText } from './custom-number-column.js';
import { choiceColumn, choiceValue, choiceNumericValue } from './custom-choice-column.js';
import { checkmarkText, checkmarkValue } from './custom-checkmark-column.js';
import { formulaColumn, formulaNumberSourceValue, formulaText } from './custom-formula-column.js';
import { convertLength, measureKindType } from './measure-extras.js';

export const FORMULA_CAPTIONS_VERSION = 1;
export const EXPRESSION_COLUMNS_MAX = 5;
export const EXPRESSION_TEXT_MAX = 256;
export const RESULT_UNIT_MAX = 12;
export const DECIMALS_MAX = 6;
export const CAPTION_TEMPLATE_MAX = 200;
export const CAPTION_TYPES_MAX = 64;
export const FORMULA_CAPTIONS_JSON_MAX = 16384;
export const RESULT_LENGTH_UNITS = Object.freeze(['', 'mm', 'cm', 'm', 'in', 'ft']);
const TOKENS_MAX = 128;
const DEPTH_MAX = 32;
const RESULT_LIMIT = 1e15;

/** Markups List column keys of the Formula columns, in order. */
export const EXPRESSION_COLUMN_KEYS = Object.freeze(
  Array.from({ length: EXPRESSION_COLUMNS_MAX }, (_, i) => `exprFormula${i + 1}`));

/** Index (0-4) of a Formula column key, or -1. */
export function expressionColumnIndex(key) {
  return EXPRESSION_COLUMN_KEYS.indexOf(key);
}

/**
 * Cached per-markup evaluation for one list build: (annotation) => results.
 * Returns null when the document has no Formula columns.
 */
export function expressionResultsCache(doc) {
  const list = expressionColumns(doc?.formulaCaptions?.columns);
  if (!list.length) return null;
  const sources = columnSources(doc);
  const cache = new WeakMap();
  return (ann) => {
    let results = cache.get(ann);
    if (!results) { results = evaluateExpressionColumns(ann, doc, list, sources); cache.set(ann, results); }
    return results;
  };
}

/** Measurement references: canonical key -> display name. */
export const MEASURE_REFERENCES = Object.freeze({
  length: 'Length', area: 'Area', volume: 'Volume', count: 'Count', depth: 'Depth', wallArea: 'Wall Area',
});
// Power of the length unit per measurement value (0 = unitless).
const MEASURE_POWER = Object.freeze({ length: 1, area: 2, volume: 3, count: 0, depth: 1, wallArea: 2 });

const fold = name => String(name ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
const MEASURE_BY_NAME = new Map(Object.entries(MEASURE_REFERENCES).flatMap(([key, label]) =>
  [[fold(label), key], [fold(key), key], [fold(label.replace(/\s+/gu, '')), key]]));

/** The measurement key ('area', ...) a reference names, or null. */
export function measureReferenceKey(name) {
  return MEASURE_BY_NAME.get(fold(name)) || null;
}

// ── Expression parsing ────────────────────────────────────────────────────

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/u.test(ch)) { i++; continue; }
    if ('+-*/()×÷−'.includes(ch)) {
      tokens.push({ t: 'op', v: ch === '×' ? '*' : ch === '÷' ? '/' : ch === '−' ? '-' : ch });
      i++;
    } else if (/[0-9.]/u.test(ch)) {
      const m = /^(?:\d+(?:\.\d+)?|\.\d+)/u.exec(text.slice(i));
      if (!m) throw new Error(`Invalid number at ${i + 1}`);
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      const end = text.indexOf(close, i + 1);
      if (end < 0) throw new Error(`Missing ${close}`);
      if (!text.slice(i + 1, end).trim()) throw new Error(`Empty reference at ${i + 1}`);
      tokens.push({ t: 'ref', v: text.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[A-Za-z_]/u.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(text.slice(i));
      tokens.push({ t: 'ref', v: m[0] });
      i += m[0].length;
    } else {
      throw new Error(`Unexpected "${ch}" at ${i + 1}`);
    }
    if (tokens.length > TOKENS_MAX) throw new Error('Expression is too long');
  }
  return tokens;
}

/**
 * Parse an expression into a small tree: {n} constant, {r} reference,
 * {u, a} negation, {o, a, b} binary operation. Returns { ast, refs } or
 * { error }. No eval, no Function: a recursive-descent parser.
 */
export function parseFormulaExpression(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'Enter an expression.' };
  if (text.length > EXPRESSION_TEXT_MAX) return { error: `Use at most ${EXPRESSION_TEXT_MAX} characters.` };
  let tokens;
  try { tokens = tokenize(text); } catch (error) { return { error: error.message }; }
  let pos = 0;
  const refs = [];
  const peek = () => tokens[pos];
  const isOp = (...ops) => peek()?.t === 'op' && ops.includes(peek().v);
  const expr = (depth) => {
    if (depth > DEPTH_MAX) throw new Error('Too many nested parentheses');
    let left = term(depth);
    while (isOp('+', '-')) { const o = tokens[pos++].v; left = { o, a: left, b: term(depth) }; }
    return left;
  };
  const term = (depth) => {
    let left = unary(depth);
    while (isOp('*', '/')) { const o = tokens[pos++].v; left = { o, a: left, b: unary(depth) }; }
    return left;
  };
  const unary = (depth) => {
    if (isOp('-')) { pos++; return { u: '-', a: unary(depth + 1) }; }
    if (isOp('+')) { pos++; return unary(depth + 1); }
    return primary(depth);
  };
  const primary = (depth) => {
    const token = tokens[pos++];
    if (!token) throw new Error('Expression ends early');
    if (token.t === 'num') return { n: token.v };
    if (token.t === 'ref') { refs.push(token.v); return { r: token.v }; }
    if (token.v === '(') {
      const inner = expr(depth + 1);
      if (!isOp(')')) throw new Error('Missing )');
      pos++;
      return inner;
    }
    throw new Error(`Unexpected "${token.v}"`);
  };
  try {
    const ast = expr(0);
    if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].v}"`);
    return { ast, refs };
  } catch (error) {
    return { error: error.message };
  }
}

function evaluateAst(node, resolve) {
  if ('n' in node) return node.n;
  if ('r' in node) return resolve(node.r);
  if ('u' in node) { const a = evaluateAst(node.a, resolve); return a === null ? null : -a; }
  const a = evaluateAst(node.a, resolve);
  const b = evaluateAst(node.b, resolve);
  if (a === null || b === null) return null;
  if (node.o === '+') return a + b;
  if (node.o === '-') return a - b;
  if (node.o === '*') return a * b;
  if (b === 0) return null;
  return a / b;
}

// ── Definitions ───────────────────────────────────────────────────────────

/** A validated Formula column definition, or null. */
export function expressionColumn(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = customTextColumnName(value.name);
  if (!name || measureReferenceKey(name)) return null;
  if (typeof value.expression !== 'string' || parseFormulaExpression(value.expression).error) return null;
  const unit = value.unit == null ? '' : String(value.unit).trim();
  if (unit.length > RESULT_UNIT_MAX || /[\u0000-\u001f\u007f-\u009f{}]/u.test(unit)) return null;
  const decimals = value.decimals == null ? 2 : value.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > DECIMALS_MAX) return null;
  const lengthUnit = value.lengthUnit == null ? '' : value.lengthUnit;
  if (!RESULT_LENGTH_UNITS.includes(lengthUnit)) return null;
  return { name, expression: value.expression.trim(), unit, decimals, lengthUnit };
}

/** Validated Formula columns (max 5, unique names); invalid entries are dropped. */
export function expressionColumns(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const entry of list) {
    const column = expressionColumn(entry);
    if (!column || out.some(other => fold(other.name) === fold(column.name))) continue;
    out.push(column);
    if (out.length >= EXPRESSION_COLUMNS_MAX) break;
  }
  return out;
}

/** A caption template (single line, bounded) or '' for none. */
export function captionTemplate(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\r\n\t]+/gu, ' ').trim();
  if (!text || text.length > CAPTION_TEMPLATE_MAX || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return '';
  return text;
}

/** Per-type caption templates { [type]: template }, validated. */
export function captionTemplates(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [type, template] of Object.entries(value).slice(0, CAPTION_TYPES_MAX)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,47}$/u.test(type)) continue;
    const text = captionTemplate(template);
    if (text) out[type] = text;
  }
  return out;
}

/** The document-level model: { v, columns, captions }, validated. */
export function formulaCaptionsModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.v !== undefined && value.v !== FORMULA_CAPTIONS_VERSION) return null;
  return { v: FORMULA_CAPTIONS_VERSION, columns: expressionColumns(value.columns),
    captions: captionTemplates(value.captions) };
}

/** True when the model holds nothing worth saving. */
export function isEmptyFormulaCaptions(model) {
  return !model || (!model.columns?.length && !Object.keys(model.captions || {}).length);
}

// ── Values ────────────────────────────────────────────────────────────────

const LENGTH_TYPES = new Set(['measureDistance', 'measurePerimeter']);

/**
 * The measurement values of a markup in its own unit, plus whether they are
 * calibrated. Count is 1 for a count marker and needs no calibration.
 */
export function measurementQuantities(ann) {
  const empty = { calibrated: false, unit: '', length: null, area: null, volume: null,
    count: null, depth: null, wallArea: null };
  if (!ann) return empty;
  if (ann.type === 'count') return { ...empty, count: 1 };
  if (!LENGTH_TYPES.has(ann.type) && ann.type !== 'measureArea') return empty;
  const unit = String(ann.measureUnit || '').replace(/[²³]$/u, '');
  const calibrated = ann.measureCalibrated !== false && !!unit && unit !== 'pt'
    && convertLength(1, unit, 'mm') !== null;
  const finite = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const out = { ...empty, calibrated, unit };
  if (LENGTH_TYPES.has(ann.type)) out.length = finite(ann.measureValue);
  else out.area = finite(ann.measureValue);
  out.volume = finite(ann.measureVolumeValue);
  out.wallArea = finite(ann.measureWallAreaValue);
  const depth = finite(ann.measureDepth);
  if (depth !== null && depth > 0) {
    // Uncalibrated: keep the raw depth; the formula reports 'uncalibrated'.
    out.depth = calibrated ? convertLength(depth, ann.measureDepthUnit || unit, unit) : depth;
  }
  return out;
}

/**
 * Named numeric sources of a document: folded name -> (annotation) => number
 * or null. Number columns, numeric Choice columns and the bounded Formula.
 */
export function columnSources(doc) {
  const sources = new Map();
  const add = (name, get) => { if (name && !sources.has(fold(name))) sources.set(fold(name), get); };
  const number = numberColumn(doc?.markupNumberColumn);
  const number2 = numberColumn(doc?.markupNumberColumn2);
  const choice = choiceColumn(doc?.markupChoiceColumn);
  const choice2 = choiceColumn(doc?.markupChoiceColumn2);
  if (number) add(number.name, ann => numberValue(ann.markupNumberValue));
  if (number2) add(number2.name, ann => numberValue(ann.markupNumberValue2));
  if (choice) add(choice.name, ann => numberValue(choiceNumericValue(ann.markupChoiceValue, choice)));
  if (choice2) add(choice2.name, ann => numberValue(choiceNumericValue(ann.markupChoiceValue2, choice2)));
  const legacy = formulaColumn(doc?.markupFormulaColumn, number, doc?.markupTextColumnName,
    choice?.name, doc?.markupCheckmarkColumn?.name, choice, number2);
  if (legacy) {
    add(legacy.name, ann => {
      const text = formulaText(formulaNumberSourceValue(ann, legacy), legacy, ann.markupChoiceValue, choice);
      return text === '' ? null : Number(text);
    });
  }
  return sources;
}

/** Names of the document's other custom columns (for unique-name checks). */
export function otherColumnNames(doc) {
  return [doc?.markupTextColumnName, doc?.markupTextColumn2Name, doc?.markupChoiceColumn?.name,
    doc?.markupChoiceColumn2?.name, doc?.markupNumberColumn?.name, doc?.markupNumberColumn2?.name,
    doc?.markupCheckmarkColumn?.name, doc?.markupFormulaColumn?.name].filter(Boolean);
}

/**
 * Check a proposed column against the document: parse errors, unknown or
 * non-numeric references and clashing names. `index` is its position (only
 * earlier Formula columns can be referenced). Returns an error string or ''.
 */
export function expressionColumnError(proposal, doc, columns = [], index = columns.length) {
  const name = customTextColumnName(proposal?.name);
  if (!name) return 'Enter a single-line column name.';
  if (measureReferenceKey(name)) return `"${name}" is a measurement value name.`;
  if (otherColumnNames(doc).some(other => fold(other) === fold(name))
      || columns.some((column, i) => i !== index && fold(column.name) === fold(name))) {
    return `Another column is already named "${name}".`;
  }
  const parsed = parseFormulaExpression(proposal?.expression);
  if (parsed.error) return parsed.error;
  const sources = columnSources(doc);
  const earlier = columns.slice(0, index).map(column => fold(column.name));
  for (const ref of parsed.refs) {
    if (measureReferenceKey(ref) || sources.has(fold(ref)) || earlier.includes(fold(ref))) continue;
    if (fold(ref) === fold(name)) return 'A formula cannot refer to itself.';
    return `Unknown or non-numeric column "${ref}".`;
  }
  if (!expressionColumn(proposal)) return 'Check the unit (12 characters) and decimals (0-6).';
  return '';
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Evaluate every Formula column for one markup. Returns one entry per column:
 * { value, text, warning } with warning null, 'uncalibrated' (a physical
 * measurement value without calibration), 'unit' (no conversion to the
 * chosen length unit), 'missing' (a referenced value is blank or the markup
 * has no such measurement) or 'error' (division by zero, overflow).
 */
export function evaluateExpressionColumns(ann, doc, columns = doc?.formulaCaptions?.columns,
  sources = columnSources(doc)) {
  const list = expressionColumns(columns);
  const results = [];
  const byName = new Map();
  const quantities = measurementQuantities(ann);
  list.forEach(column => {
    let warning = null;
    const parsed = parseFormulaExpression(column.expression);
    const resolve = (ref) => {
      const key = measureReferenceKey(ref);
      if (key) {
        const raw = quantities[key];
        if (raw === null || raw === undefined) { warning ||= 'missing'; return null; }
        const power = MEASURE_POWER[key];
        if (power === 0) return raw;
        if (!quantities.calibrated) { warning = 'uncalibrated'; return null; }
        if (!column.lengthUnit) return raw;
        const factor = convertLength(1, quantities.unit, column.lengthUnit);
        if (factor === null) { warning = warning === 'uncalibrated' ? warning : 'unit'; return null; }
        return raw * factor ** power;
      }
      const folded = fold(ref);
      if (byName.has(folded)) {
        const earlier = byName.get(folded);
        if (earlier.value === null) warning ||= earlier.warning || 'missing';
        return earlier.value;
      }
      const source = sources.get(folded);
      const value = source ? source(ann) : null;
      if (value === null) warning ||= 'missing';
      return value;
    };
    let value = parsed.ast ? evaluateAst(parsed.ast, resolve) : null;
    if (value !== null && (!Number.isFinite(value) || Math.abs(value) >= RESULT_LIMIT)) value = null;
    if (value === null && !warning) warning = 'error';
    if (value !== null) { value = roundTo(value, column.decimals); warning = null; }
    const result = { name: column.name, value, text: formatExpressionResult(value, column), warning };
    results.push(result);
    byName.set(fold(column.name), result);
  });
  return results;
}

/** Display text of a result: fixed decimals plus the column's unit label. */
export function formatExpressionResult(value, column) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const text = value.toFixed(column?.decimals ?? 2);
  return column?.unit ? `${text} ${column.unit}` : text;
}

/**
 * Column totals over `annotations`: { name, total, text, counted, uncalibrated }
 * per Formula column. Blank results (uncalibrated, missing) are not added.
 */
export function expressionColumnTotals(annotations, doc, columns = doc?.formulaCaptions?.columns) {
  const list = expressionColumns(columns);
  const sources = columnSources(doc);
  const totals = list.map(column => ({ name: column.name, total: 0, counted: 0, uncalibrated: 0, column }));
  for (const ann of annotations || []) {
    evaluateExpressionColumns(ann, doc, list, sources).forEach((result, i) => {
      if (result.value !== null) { totals[i].total += result.value; totals[i].counted++; }
      else if (result.warning === 'uncalibrated') totals[i].uncalibrated++;
    });
  }
  return totals.map(({ column, ...total }) => {
    const value = roundTo(total.total, column.decimals);
    return { ...total, total: value, text: total.counted ? formatExpressionResult(value, column) : '' };
  });
}

// ── Custom Captions ───────────────────────────────────────────────────────

/** Template for a markup: its own, else the document's for its type, else ''. */
export function captionTemplateFor(ann, doc) {
  const own = captionTemplate(ann?.captionTemplate);
  if (own) return own;
  const captions = doc?.formulaCaptions?.captions;
  return captions ? captionTemplate(captions[measureKindType(ann)] || captions[ann?.type]) : '';
}

function plainMeasure(value, unit) {
  return `${Number(value.toFixed(2))} ${unit}`;
}

/**
 * Text of a caption template for a markup. Tokens: {Subject}, {Comment},
 * {Author}, {Page}, {Status}, measurement values ({Length}, {Area}, ...), any
 * custom column and any Formula column. An unknown token stays as written; a
 * known one without a value is blank. Physical values of an uncalibrated
 * markup carry "(scale not set)". `formatMeasurement` (optional) formats a
 * calibrated value like the canvas labels do.
 */
export function captionText(template, ann, doc, { formatMeasurement } = {}) {
  const text = captionTemplate(template);
  if (!text || !ann) return '';
  const quantities = measurementQuantities(ann);
  const units = { length: '', area: '²', volume: '³', depth: '', wallArea: '²' };
  const results = evaluateExpressionColumns(ann, doc);
  const formulaByName = new Map(results.map(result => [fold(result.name), result]));
  const number = numberColumn(doc?.markupNumberColumn);
  const number2 = numberColumn(doc?.markupNumberColumn2);
  const choice = choiceColumn(doc?.markupChoiceColumn);
  const choice2 = choiceColumn(doc?.markupChoiceColumn2);
  const legacy = columnSources(doc);
  const fields = new Map([
    ['subject', () => ann.subject || ''],
    ['comment', () => (typeof ann.text === 'string' ? ann.text : '') || ''],
    ['author', () => ann.author || ''],
    ['page', () => String(ann.page ?? '')],
    ['status', () => (ann.status && ann.status !== 'none' ? String(ann.status) : '')],
  ]);
  const addColumn = (name, get) => { if (name && !fields.has(fold(name))) fields.set(fold(name), get); };
  addColumn(doc?.markupTextColumnName, () => ann.markupTextValue || '');
  addColumn(doc?.markupTextColumn2Name, () => ann.markupTextValue2 || '');
  if (choice) addColumn(choice.name, () => choiceValue(ann.markupChoiceValue, choice.options));
  if (choice2) addColumn(choice2.name, () => choiceValue(ann.markupChoiceValue2, choice2.options));
  if (number) addColumn(number.name, () => numberText(ann.markupNumberValue));
  if (number2) addColumn(number2.name, () => numberText(ann.markupNumberValue2));
  if (doc?.markupCheckmarkColumn?.name) {
    addColumn(doc.markupCheckmarkColumn.name, () => checkmarkText(checkmarkValue(ann.markupCheckmarkValue)));
  }
  const legacyName = doc?.markupFormulaColumn?.name;
  if (legacyName && legacy.has(fold(legacyName))) {
    addColumn(legacyName, () => { const v = legacy.get(fold(legacyName))(ann); return v === null ? '' : String(v); });
  }
  const out = text.replace(/\{([^{}]{1,64})\}/gu, (whole, name) => {
    const folded = fold(name);
    const key = measureReferenceKey(name);
    if (key) {
      const value = quantities[key];
      if (value === null || value === undefined) return '';
      if (key === 'count') return String(value);
      const unit = `${quantities.unit}${units[key]}`;
      if (!quantities.calibrated) return `${plainMeasure(value, unit || 'pt')} (scale not set)`;
      return formatMeasurement ? formatMeasurement({ value, unit, calibrated: true }) : plainMeasure(value, unit);
    }
    if (formulaByName.has(folded)) return formulaByName.get(folded).text;
    if (fields.has(folded)) return fields.get(folded)();
    return whole;
  });
  return out.replace(/\s{2,}/gu, ' ').trim();
}
