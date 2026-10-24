// Which unit measurements are shown in (and whether the other system goes
// beside them): an app preference. Changing it relabels every measurement.
import { state } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';
import { recalculateAllMeasurements } from './measurement.js';
import { redrawAnnotations } from './rendering.js';
import { DISPLAY_UNITS } from './measure-precision.js';

export const DISPLAY_UNIT_LABELS = Object.freeze({
  auto: 'unitAuto', 'ft-in': 'unitFtIn', in: 'unitIn', ft: 'unitFt', mm: 'unitMm', cm: 'unitCm', m: 'unitM',
});

export function measureDisplay() {
  const unit = state.preferences?.measureDisplayUnit;
  return { unit: DISPLAY_UNITS.includes(unit) ? unit : 'auto', dual: !!state.preferences?.measureDualUnits };
}

export function setMeasureDisplay({ unit, dual } = {}) {
  if (unit !== undefined && DISPLAY_UNITS.includes(unit)) state.preferences.measureDisplayUnit = unit;
  if (dual !== undefined) state.preferences.measureDualUnits = !!dual;
  savePreferences();
  recalculateAllMeasurements();
  redrawAnnotations();
}
