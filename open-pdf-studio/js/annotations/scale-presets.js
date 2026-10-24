// Set Scale model: the built-in scale presets, the scale equation
// "[paper length] [paper unit] = [real length] [real unit]" and the user's
// own presets. No app state and no UI, so node tests every rule that turns
// a preset or a typed equation into a calibration.
//
// PDF user space is 1/72 inch on paper, so a paper length L in paper units
// is L * 72 * inchesPerUnit(paper) points; the scale is that many points per
// real length in the real unit.

import { INCHES_PER_UNIT, SCALE_UNITS, parseLengthInput, formatRatio } from './scale-entry.js';

const IMPERIAL = new Set(['in', 'ft']);
export const isImperialUnit = (unit) => IMPERIAL.has(unit);

const ARCH_PAPER = [
  ['1/32', 1 / 32], ['1/16', 1 / 16], ['3/32', 3 / 32], ['1/8', 1 / 8], ['3/16', 3 / 16],
  ['1/4', 1 / 4], ['3/8', 3 / 8], ['1/2', 1 / 2], ['3/4', 3 / 4], ['1', 1], ['1 1/2', 1.5], ['3', 3],
];
const ENG_REAL = [10, 20, 30, 40, 50, 60, 100, 200];
const METRIC_RATIOS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/**
 * Built-in presets per group. Imperial presets are an inch on paper against
 * feet; metric presets are 1 mm against N mm (re-expressed in the current
 * metric real unit when one is chosen, see presetEquation).
 * @type {Array<{group:'architectural'|'engineering'|'metric', presets:Array<{id:string,label:string,
 *   paperText:string, paperValue:number, paperUnit:string, realValue:number, realUnit:string}>}>}
 */
export const SCALE_PRESET_GROUPS = [
  {
    group: 'architectural',
    presets: ARCH_PAPER.map(([text, value]) => ({
      id: `arch:${text.replace(' ', '-')}`,
      label: `${text.replace(' ', '-')}" = 1'-0"`,
      paperText: text, paperValue: value, paperUnit: 'in', realValue: 1, realUnit: 'ft',
    })),
  },
  {
    group: 'engineering',
    presets: ENG_REAL.map(n => ({
      id: `eng:${n}`, label: `1" = ${n}'`,
      paperText: '1', paperValue: 1, paperUnit: 'in', realValue: n, realUnit: 'ft',
    })),
  },
  {
    group: 'metric',
    presets: METRIC_RATIOS.map(n => ({
      id: `metric:${n}`, label: `1:${n}`,
      paperText: '1', paperValue: 1, paperUnit: 'mm', realValue: n, realUnit: 'mm',
    })),
  },
];

const BUILT_IN = new Map(SCALE_PRESET_GROUPS.flatMap(g => g.presets).map(p => [p.id, p]));
export const builtInPreset = (id) => BUILT_IN.get(id) || null;

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** A short decimal for a field: no float noise, no trailing zeros. */
export function fieldText(value) {
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toPrecision(10)));
}

const NUM = String.raw`(\d+(?:[.,]\d+)?|[.,]\d+)`;
const toNumber = (s) => parseFloat(String(s).replace(',', '.'));
// "1/4", "1 1/2", "1-1/2", "2", "0.25"
const PLAIN = new RegExp(String.raw`^(?:${NUM})?(?:(?:^|\s+|-)(\d+)\/(\d+))?$`);

/**
 * A length typed in one equation field, in that field's unit. Accepts plain
 * numbers and fractions ("1/4", "1 1/2"), any length parseLengthInput takes
 * (feet-inch such as 10'-6", or a number with its own unit), converted to
 * the field unit.
 * @param {string} text
 * @param {string} unit one of SCALE_UNITS
 * @returns {number|null}
 */
export function parseEquationLength(text, unit) {
  if (!SCALE_UNITS.includes(unit)) return null;
  const s = String(text ?? '').trim();
  if (!s) return null;
  const plain = s.match(PLAIN);
  if (plain && (plain[1] != null || plain[2] != null)) {
    let value = plain[1] != null ? toNumber(plain[1]) : 0;
    if (plain[2] != null) {
      const den = Number(plain[3]);
      if (!den) return null;
      value += Number(plain[2]) / den;
    }
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const parsed = parseLengthInput(s, unit);
  if (!parsed) return null;
  const value = parsed.value * INCHES_PER_UNIT[parsed.unit] / INCHES_PER_UNIT[unit];
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Validate a scale equation. Units may mix systems (1 in = 8 ft, 1 mm = 0.1 m).
 * @param {{paperValue:number, paperUnit:string, realValue:number, realUnit:string}} eq
 * @returns {{paperValue:number, paperUnit:string, realValue:number, realUnit:string}|null}
 */
export function validEquation(eq) {
  if (!eq) return null;
  const { paperValue, paperUnit, realValue, realUnit } = eq;
  if (!SCALE_UNITS.includes(paperUnit) || !SCALE_UNITS.includes(realUnit)) return null;
  if (!(Number.isFinite(paperValue) && paperValue > 0 && Number.isFinite(realValue) && realValue > 0)) return null;
  return { paperValue, paperUnit, realValue, realUnit };
}

/**
 * Parse the four equation fields.
 * @returns {{paperValue:number, paperUnit:string, realValue:number, realUnit:string}|null}
 */
export function parseScaleEquation(paperText, paperUnit, realText, realUnit) {
  return validEquation({
    paperValue: parseEquationLength(paperText, paperUnit), paperUnit,
    realValue: parseEquationLength(realText, realUnit), realUnit,
  });
}

/** PDF points per real unit for an equation, or null. */
export function equationPixelsPerUnit(eq) {
  const e = validEquation(eq);
  if (!e) return null;
  const ppu = (e.paperValue * 72 * INCHES_PER_UNIT[e.paperUnit]) / e.realValue;
  return Number.isFinite(ppu) && ppu > 0 ? ppu : null;
}

/** The 1:N denominator of an equation (both sides in the same length). */
export function equationRatio(eq) {
  const e = validEquation(eq);
  if (!e) return null;
  const n = (e.realValue * INCHES_PER_UNIT[e.realUnit]) / (e.paperValue * INCHES_PER_UNIT[e.paperUnit]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "1 in = 8 ft", "0.25 in = 1 ft", "1 mm = 0.1 m". */
export function equationText(eq) {
  const e = validEquation(eq);
  if (!e) return '';
  return `${fieldText(e.paperValue)} ${e.paperUnit} = ${fieldText(e.realValue)} ${e.realUnit}`;
}

/** "0.25 in = 1 ft" (equationText) back to an equation, else null. */
export function equationFromText(text) {
  const m = String(text ?? '').trim().match(/^(\S+)\s*(mm|cm|m|in|ft)\s*=\s*(\S+)\s*(mm|cm|m|in|ft)$/u);
  if (!m) return null;
  return validEquation({ paperValue: Number(m[1]), paperUnit: m[2], realValue: Number(m[3]), realUnit: m[4] });
}

/**
 * The page scale for applyPageScale. Measurements come out in the real unit.
 * @param {object} eq
 * @param {{method?:string, precision?:number|string}} [extra]
 * @returns {{pixelsPerUnit:number, unit:string, method:string, scaleRatio:string,
 *   equation:object, precision?:number|string}|null}
 */
export function scaleDataFromEquation(eq, extra = {}) {
  const e = validEquation(eq);
  const ppu = equationPixelsPerUnit(e);
  if (!ppu) return null;
  const data = {
    pixelsPerUnit: ppu, unit: e.realUnit, method: extra.method || 'ratio',
    scaleRatio: formatRatio(equationRatio(e)), equation: { ...e },
  };
  if (extra.precision != null) data.precision = extra.precision;
  return data;
}

/**
 * The equation to show for an existing scale: the one it was set with, else
 * one paper unit (in for imperial, mm for metric) against its real length.
 */
export function equationFromScale(scale) {
  if (!scale || !(scale.pixelsPerUnit > 0) || !SCALE_UNITS.includes(scale.unit)) return null;
  // In memory the equation is on the scale; from a saved PDF it is the /R
  // text ("0.25 in = 1 ft"), which the page scale carries as scaleRatio.
  for (const own of [validEquation(scale.equation), equationFromText(scale.scaleRatio)]) {
    if (own && own.realUnit === scale.unit && near(equationPixelsPerUnit(own), scale.pixelsPerUnit)) return own;
  }
  const paperUnit = isImperialUnit(scale.unit) ? 'in' : 'mm';
  return validEquation({ paperValue: 1, paperUnit,
    realValue: (72 * INCHES_PER_UNIT[paperUnit]) / scale.pixelsPerUnit, realUnit: scale.unit });
}

/**
 * The equation a preset stands for, with the real side in `realUnit` when it
 * is of the preset's own system (1:100 with m gives 1 mm = 0.1 m; 1/4" = 1'-0"
 * with in gives 1/4 in = 12 in). Other units fall back to the preset's own.
 * @returns {{paperText:string, realText:string, paperValue:number, paperUnit:string,
 *   realValue:number, realUnit:string}|null}
 */
export function presetEquation(preset, realUnit) {
  if (!preset) return null;
  const sameSystem = SCALE_UNITS.includes(realUnit) && isImperialUnit(realUnit) === isImperialUnit(preset.realUnit);
  const unit = preset.user || !sameSystem ? preset.realUnit : realUnit;
  const realValue = preset.realValue * INCHES_PER_UNIT[preset.realUnit] / INCHES_PER_UNIT[unit];
  return {
    paperText: preset.paperText ?? fieldText(preset.paperValue),
    paperValue: preset.paperValue, paperUnit: preset.paperUnit,
    realText: fieldText(realValue), realValue, realUnit: unit,
  };
}

/**
 * The preset an equation equals: a user preset with the same four values,
 * else a built-in one with the same ratio whose paper and real sides are in
 * the preset's unit systems. Null for a custom scale.
 */
export function matchingPreset(eq, userPresets = []) {
  const e = validEquation(eq);
  if (!e) return null;
  for (const p of userPresets) {
    if (p.paperUnit === e.paperUnit && p.realUnit === e.realUnit
      && near(p.paperValue, e.paperValue) && near(p.realValue, e.realValue)) return p;
  }
  const n = equationRatio(e);
  for (const p of BUILT_IN.values()) {
    if (isImperialUnit(p.paperUnit) !== isImperialUnit(e.paperUnit)) continue;
    if (isImperialUnit(p.realUnit) !== isImperialUnit(e.realUnit)) continue;
    if (p.paperUnit !== e.paperUnit) continue;
    if (Math.abs(equationRatio(p) - n) < 1e-6 * n) return p;
  }
  return null;
}

// ── User presets (local, like the Tool Chest's My Tools) ────────────────────

export const USER_SCALE_PRESETS_KEY = 'oculith-scale-presets-v1';
export const MAX_USER_SCALE_PRESETS = 50;

function cleanUserPreset(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^user:[\w-]{1,40}$/u.test(raw.id)) return null;
  const e = validEquation(raw);
  if (!e) return null;
  return { id: raw.id, user: true, label: equationText(e), paperText: fieldText(e.paperValue), ...e };
}

/**
 * The user's presets from local storage, invalid entries dropped.
 * @param {Storage|undefined} [storage]
 */
export function loadUserScalePresets(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(USER_SCALE_PRESETS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.map(cleanUserPreset).filter(Boolean).slice(0, MAX_USER_SCALE_PRESETS);
  } catch {
    return [];
  }
}

function storeUserScalePresets(list, storage) {
  const plain = list.map(({ id, paperValue, paperUnit, realValue, realUnit }) =>
    ({ id, paperValue, paperUnit, realValue, realUnit }));
  try { storage?.setItem(USER_SCALE_PRESETS_KEY, JSON.stringify(plain)); } catch { /* session still works */ }
}

/**
 * Save an equation as a user preset (newest first). The same equation is
 * not stored twice; it moves to the top instead.
 * @returns {{presets:Array<object>, preset:object|null}}
 */
export function addUserScalePreset(eq, storage = globalThis.localStorage) {
  const e = validEquation(eq);
  const current = loadUserScalePresets(storage);
  if (!e) return { presets: current, preset: null };
  const existing = matchingPreset(e, current);
  const preset = existing?.user ? existing
    : cleanUserPreset({ id: `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, ...e });
  const presets = [preset, ...current.filter(p => p.id !== preset.id)].slice(0, MAX_USER_SCALE_PRESETS);
  storeUserScalePresets(presets, storage);
  return { presets, preset };
}

/** Delete a user preset. Built-in presets cannot be deleted. */
export function deleteUserScalePreset(id, storage = globalThis.localStorage) {
  const current = loadUserScalePresets(storage);
  const presets = current.filter(p => p.id !== id);
  if (presets.length !== current.length) storeUserScalePresets(presets, storage);
  return presets;
}

/** Paper length of a picked distance (PDF points) in a paper unit. */
export function paperLengthFromPoints(points, paperUnit) {
  if (!(points > 0) || !SCALE_UNITS.includes(paperUnit)) return null;
  return points / 72 / INCHES_PER_UNIT[paperUnit];
}
