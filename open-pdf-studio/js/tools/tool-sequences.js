// Tool Chest sequences (the external editor "Sequences"): a saved tool can carry a label
// pattern such as prefix "D-", start 1, step 1, two digits. Every placement
// with that tool stamps the next value (D-01, D-02, ...) into the new markup.
//
// The pattern lives in the local preset. The next value belongs to the
// document: doc.toolSequences maps a sequence key (prefix + suffix) to the
// next number, and the saver writes that map into the PDF catalog
// (OPS_ToolSequences, see js/pdf/saver/tool-sequences-catalog.js), so a
// reopened PDF continues the numbering. Tools that share a prefix and suffix
// share one counter in a document.
//
// Pure data helpers, no app imports.

export const SEQUENCE_LIMITS = Object.freeze({
  affix: 16, maxValue: 999999, maxStep: 1000, maxDigits: 6, maxEntries: 200,
});

// Markups whose visible text receives the label (and so the Markups List
// Comment column). Every sequenced markup also gets the label as its
// subject (Markups List Subject column; /Contents for non-text markups).
export const SEQUENCE_TEXT_TYPES = new Set(['textbox', 'callout', 'typewriter']);

const affixPattern = /^[^\u0000-\u001f\u007f-\u009f]{0,16}$/u;

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** A validated copy of a sequence pattern, or null. */
export function cleanSequence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some(key => !['prefix', 'suffix', 'start', 'step', 'digits'].includes(key))) return null;
  const prefix = value.prefix ?? '';
  const suffix = value.suffix ?? '';
  if (typeof prefix !== 'string' || typeof suffix !== 'string' ||
      !affixPattern.test(prefix) || !affixPattern.test(suffix)) return null;
  if (!integer(value.start, 0, SEQUENCE_LIMITS.maxValue) ||
      !integer(value.step, 1, SEQUENCE_LIMITS.maxStep) ||
      !integer(value.digits, 1, SEQUENCE_LIMITS.maxDigits)) return null;
  return { prefix, suffix, start: value.start, step: value.step, digits: value.digits };
}

/** Counter key in the document: tools with the same prefix and suffix share it. */
export function sequenceKey(sequence) {
  return `${sequence.prefix}\u0001${sequence.suffix}`;
}

/** Label for a value: prefix + zero-padded number + suffix. */
export function formatSequenceLabel(sequence, value) {
  return `${sequence.prefix}${String(value).padStart(sequence.digits, '0')}${sequence.suffix}`;
}

function counters(doc) {
  if (!doc) return null;
  if (!doc.toolSequences || typeof doc.toolSequences !== 'object' || Array.isArray(doc.toolSequences)) {
    doc.toolSequences = {};
  }
  return doc.toolSequences;
}

/** The value the next placement in this document will use. */
export function nextSequenceValue(doc, sequence) {
  const clean = cleanSequence(sequence);
  if (!clean) return null;
  const stored = doc?.toolSequences?.[sequenceKey(clean)];
  return integer(stored, 0, SEQUENCE_LIMITS.maxValue) ? stored : clean.start;
}

/** Set the next value for this document (Tool Chest settings: edit or reset). */
export function setNextSequenceValue(doc, sequence, value) {
  const clean = cleanSequence(sequence);
  const map = counters(doc);
  if (!clean || !map || !integer(value, 0, SEQUENCE_LIMITS.maxValue)) return false;
  map[sequenceKey(clean)] = value;
  return true;
}

/**
 * Take the next label for a placement and advance the document counter by
 * the step. Returns the label, or null when the document has no room.
 */
export function takeSequenceLabel(doc, sequence) {
  const clean = cleanSequence(sequence);
  const map = counters(doc);
  if (!clean || !map) return null;
  const value = nextSequenceValue(doc, clean);
  const key = sequenceKey(clean);
  if (!(key in map) && Object.keys(map).length >= SEQUENCE_LIMITS.maxEntries) return null;
  map[key] = Math.min(value + clean.step, SEQUENCE_LIMITS.maxValue);
  return formatSequenceLabel(clean, value);
}

/** Write a sequence label into a newly placed markup (mutates and returns it). */
export function stampSequenceLabel(annotation, label) {
  if (!annotation || typeof label !== 'string' || !label) return annotation;
  annotation.subject = label;
  if (SEQUENCE_TEXT_TYPES.has(annotation.type)) {
    const text = typeof annotation.text === 'string' ? annotation.text : '';
    annotation.text = text ? `${label} ${text}` : label;
  }
  return annotation;
}

/** Catalog form of a document's counters: [{ prefix, suffix, next }]. */
export function sequenceCountersToList(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map).slice(0, SEQUENCE_LIMITS.maxEntries).flatMap(([key, next]) => {
    const parts = key.split('\u0001');
    if (parts.length !== 2 || !integer(next, 0, SEQUENCE_LIMITS.maxValue) ||
        !affixPattern.test(parts[0]) || !affixPattern.test(parts[1])) return [];
    return [{ prefix: parts[0], suffix: parts[1], next }];
  });
}

/** Validated counters from untrusted catalog JSON. */
export function sequenceCountersFromList(list) {
  const map = {};
  if (!Array.isArray(list)) return map;
  for (const item of list.slice(0, SEQUENCE_LIMITS.maxEntries)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const { prefix, suffix, next } = item;
    if (typeof prefix !== 'string' || typeof suffix !== 'string' ||
        !affixPattern.test(prefix) || !affixPattern.test(suffix) ||
        !integer(next, 0, SEQUENCE_LIMITS.maxValue)) continue;
    map[`${prefix}\u0001${suffix}`] = next;
  }
  return map;
}
