// Set Scale dialog rules without the UI: what the dialog shows when it opens
// (an existing page scale, a scale detected in the title block, the result
// of a Calibrate pick or a measurement line, a draft kept while the pick
// ran) and what Apply commits. SetScaleDialog.jsx only binds these to
// controls, so node tests the whole path.

import { SCALE_UNITS } from './scale-entry.js';
import {
  builtInPreset, equationFromScale, fieldText, isImperialUnit, matchingPreset,
  paperLengthFromPoints, parseScaleEquation, presetEquation, scaleDataFromEquation,
} from './scale-presets.js';
import { defaultPrecision, validPrecision } from './measure-precision.js';
import { parsePageRange } from './page-range.js';

const PAGE_MODES = new Set(['all', 'current', 'custom']);

/**
 * @typedef {object} SetScaleForm
 * @property {'all'|'current'|'custom'} pagesMode
 * @property {string} rangeText
 * @property {string} presetId      built-in or user preset id, or 'custom'
 * @property {string} paperText
 * @property {string} paperUnit
 * @property {string} realText
 * @property {string} realUnit
 * @property {number|string} precision
 * @property {boolean} fromReference  the paper length is a picked/line length
 * @property {'real'|null} focus     the field to focus on open
 */

/**
 * The equation for a scale found in the title block: an architectural or
 * engineering scale (1/4" = 1'-0") opens as inches = feet so it matches its
 * preset; a metric 1:N as millimetres.
 */
export function equationForDetected(ratio, imperial = false) {
  return imperial
    ? { paperValue: 1, paperUnit: 'in', realValue: ratio / 12, realUnit: 'ft' }
    : { paperValue: 1, paperUnit: 'mm', realValue: ratio, realUnit: 'mm' };
}

function withEquation(form, eq, userPresets) {
  const preset = matchingPreset(eq, userPresets);
  // A built-in preset shows its own two sides (1/4 in = 1 ft), never its
  // paper side next to this equation's real side: 1 in = 4 ft is the same
  // scale, but 1/4 in = 4 ft is four times smaller.
  if (preset && !preset.user && preset.paperUnit === eq.paperUnit) {
    const own = presetEquation(preset, eq.realUnit);
    return { ...form, presetId: preset.id, paperText: own.paperText, paperUnit: own.paperUnit,
      realText: own.realText, realUnit: own.realUnit };
  }
  return { ...form, presetId: preset ? preset.id : 'custom',
    paperText: fieldText(eq.paperValue), paperUnit: eq.paperUnit,
    realText: fieldText(eq.realValue), realUnit: eq.realUnit };
}

/**
 * The form when the dialog opens.
 * @param {object} data   dialog data: pageNum, detectedRatio, referencePixelLength, draft
 * @param {object|null} scale  the page's current scale (paginaOfDocumentSchaal)
 * @param {Array<object>} [userPresets]
 * @returns {SetScaleForm}
 */
export function initialSetScaleForm(data = {}, scale = null, userPresets = []) {
  const metric100 = presetEquation(builtInPreset('metric:100'), 'mm');
  /** @type {SetScaleForm} */
  let form = { pagesMode: 'current', rangeText: '', presetId: 'metric:100',
    paperText: metric100.paperText, paperUnit: 'mm', realText: metric100.realText, realUnit: 'mm',
    precision: defaultPrecision('mm'), fromReference: false, focus: null };

  const existing = equationFromScale(scale);
  if (existing) {
    form = withEquation(form, existing, userPresets);
    form.precision = validPrecision(scale.precision, existing.realUnit) ? scale.precision : defaultPrecision(existing.realUnit);
  } else {
    const detected = Number(data.detectedRatio);
    if (Number.isFinite(detected) && detected > 0) {
      form = withEquation(form, equationForDetected(detected, data.detectedImperial === true), userPresets);
      form.precision = defaultPrecision(form.realUnit);
    }
  }

  const draft = data.draft;
  if (draft && typeof draft === 'object') {
    if (PAGE_MODES.has(draft.pagesMode)) form.pagesMode = draft.pagesMode;
    if (typeof draft.rangeText === 'string') form.rangeText = draft.rangeText;
    if (SCALE_UNITS.includes(draft.paperUnit)) form.paperUnit = draft.paperUnit;
    if (SCALE_UNITS.includes(draft.realUnit)) form.realUnit = draft.realUnit;
    if (typeof draft.paperText === 'string') form.paperText = draft.paperText;
    if (typeof draft.realText === 'string') form.realText = draft.realText;
    if (typeof draft.presetId === 'string') form.presetId = draft.presetId;
    form.precision = validPrecision(draft.precision, form.realUnit) ? draft.precision : defaultPrecision(form.realUnit);
  }

  const points = Number(data.referencePixelLength);
  if (points > 0) {
    // 72 pt = 1 in on paper. Imperial scales measure paper in inches.
    if (!draft && !existing) {
      form.paperUnit = 'in';
      form.realUnit = 'ft';
      form.precision = defaultPrecision('ft');
    }
    const paper = paperLengthFromPoints(points, form.paperUnit);
    form.paperText = fieldText(Number(paper.toFixed(4)));
    form.realText = '';
    form.presetId = 'custom';
    form.fromReference = true;
    form.focus = 'real';
  }
  return form;
}

/**
 * The form after the real unit changes. A built-in preset stays the same
 * scale when the unit is of its own system (1:100 in m is 1 mm = 0.1 m);
 * otherwise the typed number keeps its meaning in the new unit. A new unit
 * starts at its default precision.
 */
export function changeRealUnit(form, unit) {
  if (!SCALE_UNITS.includes(unit)) return form;
  const preset = builtInPreset(form.presetId);
  let next = { ...form, realUnit: unit };
  if (preset && isImperialUnit(preset.realUnit) === isImperialUnit(unit)) {
    const eq = presetEquation(preset, unit);
    next = { ...next, paperText: eq.paperText, paperUnit: eq.paperUnit, realText: eq.realText };
  }
  if (unit !== form.realUnit || !validPrecision(next.precision, unit)) next.precision = defaultPrecision(unit);
  return next;
}

/**
 * The form after a preset is chosen (built-in or user), or 'custom'.
 * @param {SetScaleForm} form
 * @param {string} presetId
 * @param {Array<object>} userPresets
 */
export function choosePreset(form, presetId, userPresets = []) {
  const preset = builtInPreset(presetId) || userPresets.find(p => p.id === presetId) || null;
  if (!preset) return { ...form, presetId: 'custom' };
  const eq = presetEquation(preset, form.realUnit);
  const next = { ...form, presetId: preset.id, paperText: eq.paperText, paperUnit: eq.paperUnit,
    realText: eq.realText, realUnit: eq.realUnit, fromReference: false };
  if (next.realUnit !== form.realUnit || !validPrecision(next.precision, next.realUnit)) {
    next.precision = defaultPrecision(next.realUnit);
  }
  return next;
}

/** The preset an edited equation now equals, else 'custom'. */
export function presetAfterEdit(form, userPresets = []) {
  const eq = parseScaleEquation(form.paperText, form.paperUnit, form.realText, form.realUnit);
  const preset = eq ? matchingPreset(eq, userPresets) : null;
  return preset ? preset.id : 'custom';
}

/**
 * The pages a form applies to.
 * @returns {{pages:'all'|number[]} | {error:string}}
 */
export function setScalePages(form, { pageNum, pageCount }) {
  if (form.pagesMode === 'all') return { pages: 'all' };
  if (form.pagesMode === 'custom') {
    const r = parsePageRange(form.rangeText, pageCount);
    return r.error ? { error: `range.${r.error}` } : { pages: r.pages };
  }
  return { pages: [Number(pageNum) || 1] };
}

/**
 * What Apply commits: the page scale and its pages, or the error to show.
 * @param {SetScaleForm} form
 * @param {{pageNum:number, pageCount:number}} target
 * @returns {{scaleData:object, pages:'all'|number[]} | {error:string}}
 */
export function setScaleCommit(form, target) {
  const pages = setScalePages(form, target);
  if (pages.error) return pages;
  const eq = parseScaleEquation(form.paperText, form.paperUnit, form.realText, form.realUnit);
  if (!eq) return { error: 'invalidEquation' };
  const precision = validPrecision(form.precision, eq.realUnit) ? form.precision : defaultPrecision(eq.realUnit);
  const scaleData = scaleDataFromEquation(eq, { method: form.fromReference ? 'reference' : 'ratio', precision });
  if (!scaleData) return { error: 'invalidEquation' };
  return { scaleData, pages: pages.pages };
}

/** "1:48" for the equation in the form, '' while it is incomplete. */
export function formRatioText(form) {
  const r = setScaleCommit({ ...form, pagesMode: 'all' }, { pageNum: 1, pageCount: 1 });
  return r.scaleData ? r.scaleData.scaleRatio : '';
}
