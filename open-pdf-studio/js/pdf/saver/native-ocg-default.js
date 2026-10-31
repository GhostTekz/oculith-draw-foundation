// "Save layer visibility as the PDF default": write a layer view into the
// default optional-content configuration (/OCProperties /D /ON and /OFF), so
// other PDF readers open the drawing with the same layers shown.
//
// Only an explicit user command reaches this; ordinary saves leave /D alone.
// The edit is deliberately narrow: only the listed drawing layers move between
// /ON and /OFF, nothing else in /D changes, and a configuration this cannot
// change safely (locked layers, radio-button groups, layers that are not in
// /OCGs) refuses with an error instead of writing a half-applied state.
import { PDFArray, PDFDict, PDFName, PDFRef } from 'pdf-lib';

const N = (s) => PDFName.of(s);
const lookup = (context, raw) => (raw instanceof PDFRef ? context.lookup(raw) : raw);

function refKey(ref) {
  return `${ref.objectNumber} ${ref.generationNumber}`;
}

function refsIn(context, raw, out = new Set()) {
  const value = lookup(context, raw);
  if (!(value instanceof PDFArray)) return out;
  for (const item of value.asArray()) {
    if (item instanceof PDFRef) out.add(refKey(item));
    else if (lookup(context, item) instanceof PDFArray) refsIn(context, item, out);
  }
  return out;
}

/** An array of `dict` that can be edited in place (created when missing). */
function editableArray(context, dict, key) {
  const value = lookup(context, dict.get(N(key)));
  if (value instanceof PDFArray) return value;
  const created = context.obj([]);
  dict.set(N(key), created);
  return created;
}

function without(array, keys) {
  const keep = array.asArray().filter(item => !(item instanceof PDFRef && keys.has(refKey(item))));
  while (array.size() > 0) array.remove(0);
  for (const item of keep) array.push(item);
}

export class NativeOcgDefaultError extends Error {}

/**
 * Write `visibility` as the PDF's default layer visibility.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {{object_number: number, generation: number, visible: boolean}[]} visibility
 * @returns {number} the number of layers written
 */
export function writeNativeOcgDefault(pdfDoc, visibility) {
  const context = pdfDoc.context;
  const items = Array.isArray(visibility) ? visibility : [];
  if (!items.length) return 0;
  const oc = lookup(context, pdfDoc.catalog.get(N('OCProperties')));
  if (!(oc instanceof PDFDict)) throw new NativeOcgDefaultError('This PDF has no layer configuration.');
  const known = refsIn(context, oc.get(N('OCGs')));
  let d = lookup(context, oc.get(N('D')));
  if (!(d instanceof PDFDict)) {
    d = context.obj({});
    oc.set(N('D'), d);
  }
  const locked = refsIn(context, d.get(N('Locked')));
  const radio = refsIn(context, d.get(N('RBGroups')));
  const targets = new Map();
  for (const item of items) {
    const key = `${item?.object_number} ${item?.generation}`;
    if (!known.has(key)) throw new NativeOcgDefaultError(`Layer ${key} R is not part of this PDF's layer list.`);
    if (locked.has(key)) throw new NativeOcgDefaultError('A locked layer cannot change its default visibility.');
    if (radio.has(key)) throw new NativeOcgDefaultError('Layers in a choice group cannot be saved as the default yet.');
    if (typeof item.visible !== 'boolean') throw new NativeOcgDefaultError('Invalid layer visibility.');
    targets.set(key, { ref: PDFRef.of(item.object_number, item.generation), visible: item.visible });
  }
  const baseOff = String(d.get(N('BaseState'))) === '/OFF';
  const keys = new Set(targets.keys());
  const on = editableArray(context, d, 'ON');
  const off = editableArray(context, d, 'OFF');
  without(on, keys);
  without(off, keys);
  for (const { ref, visible } of targets.values()) {
    // The base state covers a layer that is in neither list; listing it
    // explicitly anyway keeps the intent clear to every reader.
    if (visible) on.push(ref);
    else off.push(ref);
  }
  if (!on.size() && !baseOff) d.delete(N('ON'));
  if (!off.size()) d.delete(N('OFF'));
  return targets.size;
}

/**
 * The default visibility of each layer as written in the PDF, for checks:
 * "id gen" → visible.
 */
export function readNativeOcgDefault(pdfDoc) {
  const context = pdfDoc.context;
  const result = new Map();
  const oc = lookup(context, pdfDoc.catalog.get(N('OCProperties')));
  if (!(oc instanceof PDFDict)) return result;
  const d = lookup(context, oc.get(N('D')));
  const baseOff = d instanceof PDFDict && String(d.get(N('BaseState'))) === '/OFF';
  const on = d instanceof PDFDict ? refsIn(context, d.get(N('ON'))) : new Set();
  const off = d instanceof PDFDict ? refsIn(context, d.get(N('OFF'))) : new Set();
  for (const key of refsIn(context, oc.get(N('OCGs')))) {
    let visible = !baseOff;
    if (on.has(key)) visible = true;
    if (off.has(key)) visible = false;
    result.set(key, visible);
  }
  return result;
}
