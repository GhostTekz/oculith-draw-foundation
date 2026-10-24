// /OPS_MeasureExtra: the plan-review measurement extras (kind, depth, slope,
// segments, centroid, caption and the computed values) as one private JSON
// text key on the measurement's own PDF annotation. See
// annotations/measure-extras.js; the loader reads it in loader/meet-extra.js.

import { PDFName } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { MEASURE_EXTRA_KEY, measureExtrasToJson } from '../../annotations/measure-extras.js';

/** Writes the key when `ann` uses an extra; returns true when written. */
export function schrijfMeetExtra(annotDict, ann) {
  if (!annotDict || typeof annotDict.set !== 'function') return false;
  const json = measureExtrasToJson(ann);
  if (!json) return false;
  annotDict.set(PDFName.of(MEASURE_EXTRA_KEY), pdfTextString(json));
  return true;
}
