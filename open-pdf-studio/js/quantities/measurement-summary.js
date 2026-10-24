// Measurement panel totals only combine values with the same known unit.
export function sumMeasurements(items) {
  const measured = (items || []).filter(m => Number.isFinite(m.measureValue));
  if (!measured.length) return null;
  const units = new Set(measured.map(m => m.measureUnit || ''));
  if (units.size !== 1 || units.has('')) return null;
  return {
    value: measured.reduce((sum, m) => sum + m.measureValue, 0),
    unit: [...units][0],
  };
}

// Kind of a measurement for selection totals: areas carry a squared unit,
// angles are never summed, everything else of a measure* type is a length.
export function measurementKind(ann) {
  if (!ann || typeof ann.type !== 'string' || !ann.type.startsWith('measure')) return null;
  if (!Number.isFinite(ann.measureValue)) return null;
  if (ann.type === 'measureAngle') return 'angle';
  const unit = ann.measureUnit || '';
  if (unit === '°') return 'angle';
  if (unit.endsWith('²')) return 'area';
  return 'length';
}

// Total of the selected measurements (Properties toolbar): only for two or
// more measurements of one kind (length or area) in one known unit. Other
// selected markups are ignored; mixed kinds or units give no total (the same
// rule as the measurement panel, sumMeasurements).
export function selectionMeasureTotal(selected) {
  const measured = (selected || []).filter(a => measurementKind(a));
  if (measured.length < 2) return null;
  const kinds = new Set(measured.map(measurementKind));
  if (kinds.size !== 1) return null;
  const kind = [...kinds][0];
  if (kind === 'angle') return null;
  const total = sumMeasurements(measured);
  if (!total) return null;
  // An uncalibrated measurement is in page points; keep that visible.
  const calibrated = !/^pt²?$/.test(total.unit);
  return { kind, count: measured.length, value: total.value, unit: total.unit, calibrated };
}
