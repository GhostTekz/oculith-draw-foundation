// Live measurement readout for the status bar: while a measure tool is
// placing points, it reports the current value here; the status bar shows it
// next to the scale indicator. The value is the same measurement object the
// on-canvas preview label is built from ({ value, unit, calibrated }), so the
// two never disagree. Tools that are not drawing clear it.

import { createSignal } from 'solid-js';

const [readout, setReadout] = createSignal(null);

export const measureReadout = readout;

// kind: 'length' | 'area' | 'angle'. measurement: { value, unit, calibrated }.
export function setMeasureReadout(kind, measurement) {
  if (!kind || !measurement || !Number.isFinite(measurement.value)) {
    clearMeasureReadout();
    return;
  }
  const next = {
    kind,
    value: measurement.value,
    unit: measurement.unit || '',
    calibrated: measurement.calibrated !== false,
    ...(measurement.precision != null ? { precision: measurement.precision } : {}),
  };
  const cur = readout();
  if (cur && cur.kind === next.kind && cur.value === next.value
    && cur.unit === next.unit && cur.calibrated === next.calibrated
    && cur.precision === next.precision) return;
  setReadout(next);
}

export function clearMeasureReadout() {
  if (readout() !== null) setReadout(null);
}

// Status-bar text. `format` is formatMeasurement (passed in so this module
// stays free of the measurement/state imports); an uncalibrated length/area
// comes back as "Scale not set · 12.5 pt". Angles never need a scale.
// `typed` (optional): the length typed for the next segment (Sketch to
// Scale, typedLengthMeasurement), shown after the value with `typedLabel`.
export function measureReadoutText(r, format, label, typed = null, typedLabel = '') {
  if (!r) return '';
  const value = r.kind === 'angle'
    ? format({ value: r.value, unit: '°', calibrated: true })
    : format({ value: r.value, unit: r.unit, calibrated: r.calibrated,
      ...(r.precision != null ? { precision: r.precision } : {}) });
  const text = label ? `${label}: ${value}` : value;
  if (!typed || r.kind === 'angle') return text;
  const typedText = format(typed);
  return `${text} \u00B7 ${typedLabel ? `${typedLabel}: ` : ''}${typedText}`;
}
