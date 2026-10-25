// Ordered candidates for an annotation repaint. The spatial index narrows
// the viewport; original positions preserve PDF markup paint order.
export function buildDrawLookup(annotations, index) {
  index.rebuild(annotations);
  const byId = new Map();
  const always = [];
  for (let position = 0; position < annotations.length; position++) {
    const annotation = annotations[position];
    const item = { position, annotation };
    if (!annotation?.id || !index.has(annotation.id)) {
      always.push(item);
      continue;
    }
    const entries = byId.get(annotation.id) || [];
    entries.push(item);
    byId.set(annotation.id, entries);
  }
  return { byId, always };
}

// `current` (the document's markups now) resolves each slot to the object
// in it now: the lookup is reused across redraws while the geometry is
// unchanged, and undo can put a new object (same id and geometry, other
// colour) in a slot.
export function visibleDrawItems(index, lookup, page, x, y, width, height, selected, current = null) {
  const byPosition = new Map();
  for (const id of index.query(page, x, y, width, height)) {
    for (const item of lookup.byId.get(id) || []) byPosition.set(item.position, item);
  }
  for (const item of lookup.always) {
    if (item.annotation?.page === page) byPosition.set(item.position, item);
  }
  // A selected markup can move into view before the next full rebuild.
  for (const annotation of selected || []) {
    for (const item of lookup.byId.get(annotation?.id) || []) byPosition.set(item.position, item);
  }
  return [...byPosition.values()]
    .sort((a, b) => a.position - b.position)
    .map((item) => (current && current[item.position]) || item.annotation);
}
