// Reads /OPS_MeasureExtra (see saver/meet-extra.js) and applies it to the
// converted measurement model.

import { PDFName } from 'pdf-lib';
import { decodePdfTextObject } from '../saver/pdf-text.js';
import { MEASURE_EXTRA_KEY, measureExtrasFromJson } from '../../annotations/measure-extras.js';

/** The raw JSON text from an annotation dictionary, as { measureExtra }. */
export function leesMeetExtra(annotDict, context) {
  if (!annotDict || typeof annotDict.get !== 'function') return {};
  const raw = annotDict.get(PDFName.of(MEASURE_EXTRA_KEY));
  if (!raw) return {};
  const text = decodePdfTextObject(context.lookup(raw) || raw);
  return typeof text === 'string' && text ? { measureExtra: text } : {};
}

/** The model with its extras restored (unchanged when there are none). */
export function metMeetExtra(model, json) {
  if (!model || !json) return model;
  const props = measureExtrasFromJson(model.type, json);
  if (props) Object.assign(model, props);
  return model;
}
