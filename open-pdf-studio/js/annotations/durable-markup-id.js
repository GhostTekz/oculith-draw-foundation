// PDF-local identity for app-created box, circle, and linear markups. Keep the wire
// value short and inert: PDF bytes are untrusted, and this value may later be
// used as a fixture key by an explicitly designed interchange layer.
export function hasDurableMarkupId(type) {
  return type === 'box' || type === 'circle' || type === 'line' || type === 'arrow';
}

export function persistsDurableMarkupId(annotation) {
  return hasDurableMarkupId(annotation?.type)
    && !(annotation.type === 'circle' && annotation.pdfCircleSubtypePresent);
}

export function validDurableMarkupId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

const randomId = () => globalThis.crypto?.randomUUID?.()
  || Date.now().toString(36) + Math.random().toString(36).slice(2, 11);

export function uniqueDurableMarkupId(candidate, used, makeId = randomId) {
  if (validDurableMarkupId(candidate) && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let fresh;
  do { fresh = makeId(); } while (!validDurableMarkupId(fresh) || used.has(fresh));
  used.add(fresh);
  return fresh;
}
