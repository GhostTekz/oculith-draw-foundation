// "Apply Scale to Viewport" without the UI: the dialog edits a viewport's
// scale with the Set Scale editor (presets, paper = real equation,
// precision; set-scale-form.js) and stores it on the scaleRegion as the
// 1:N scaleString + units the viewport model and PDF /VP use
// (named-viewports.js), plus the equation it was set with.

import { equationRatio, parseScaleEquation } from './scale-presets.js';
import { initialSetScaleForm } from './set-scale-form.js';
import { defaultPrecision, validPrecision } from './measure-precision.js';
import { pixelsPerUnitFor } from './scale-region.js';

/**
 * "1:48", "1:53.4217": whole when the ratio is (nearly) whole, else enough
 * digits that the stored 1:N gives back the equation's scale.
 */
export function viewportScaleString(denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return '';
  const rounded = Math.round(denominator);
  if (rounded >= 1 && Math.abs(denominator - rounded) < 1e-6 * rounded) return `1:${rounded}`;
  return `1:${Number(denominator.toPrecision(8))}`;
}

/**
 * The scale of viewport values ({scaleString, units, precision, equation})
 * as Set Scale reads it, or null when they are not a calibration.
 */
export function viewportScale(values) {
  const pixelsPerUnit = pixelsPerUnitFor(values?.scaleString, values?.units);
  if (!pixelsPerUnit) return null;
  return { pixelsPerUnit, unit: values.units, scaleRatio: values.scaleString,
    ...(values.precision != null ? { precision: values.precision } : {}),
    ...(values.equation ? { equation: values.equation } : {}) };
}

/**
 * The editor form when the dialog opens.
 * @param {object} data   dialog data: isNew, initial ({label, form} after a
 *   Calibrate pick or cancel, or {scaleString, units, precision}), pickedPoints
 *   (the paper length of a Calibrate pick, in PDF points)
 * @param {object|null} region     the viewport being edited
 * @param {object|null} pageScale  the page's scale (paginaOfDocumentSchaal), the start for a new viewport
 * @param {Array<object>} [userPresets]
 */
export function initialViewportForm(data = {}, region = null, pageScale = null, userPresets = []) {
  const initial = data.initial || {};
  const pick = Number(data.pickedPoints) > 0 ? { referencePixelLength: Number(data.pickedPoints) } : {};
  if (initial.form && typeof initial.form === 'object') {
    // Back from Calibrate (or its cancel): the form as the user left it.
    return initialSetScaleForm({ ...pick, draft: initial.form }, null, userPresets);
  }
  // A new viewport starts at the page scale (the tool drew it at 1:100 mm);
  // an existing one at its own.
  const scale = (initial.scaleString ? viewportScale(initial) : null)
    || (data.isNew && pageScale?.pixelsPerUnit > 0 ? pageScale : null)
    || viewportScale(region);
  return initialSetScaleForm(pick, scale, userPresets);
}

/**
 * The viewport values for pasViewportToe from the form and label, or
 * {error:'invalidEquation'} while the equation is incomplete.
 * @returns {{label:string, scaleString:string, units:string, precision:number|string, equation:object}
 *   | {error:string}}
 */
export function viewportValuesFromForm(form, label) {
  const eq = parseScaleEquation(form.paperText, form.paperUnit, form.realText, form.realUnit);
  const n = eq ? equationRatio(eq) : null;
  if (!n) return { error: 'invalidEquation' };
  const precision = validPrecision(form.precision, eq.realUnit) ? form.precision : defaultPrecision(eq.realUnit);
  return { label: String(label ?? ''), scaleString: viewportScaleString(n), units: eq.realUnit, precision, equation: eq };
}
