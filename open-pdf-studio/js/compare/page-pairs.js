// Confirmed revision matches belong to one compare session. Each page may
// participate in at most one match, so replacing either side removes its old
// association rather than leaving an ambiguous drawing revision map.
export function confirmPagePair(pairs, oldPage, newPage, confirmedAt = new Date().toISOString()) {
  if (!Number.isInteger(oldPage) || oldPage < 1 || !Number.isInteger(newPage) || newPage < 1) {
    throw new Error('Page matches require positive whole page numbers.');
  }
  const remaining = pairs.filter(pair => pair.oldPage !== oldPage && pair.newPage !== newPage);
  return [...remaining, { oldPage, newPage, source: 'manual', confirmedAt }]
    .sort((a, b) => a.oldPage - b.oldPage || a.newPage - b.newPage);
}

export function currentConfirmedPair(pairs, oldPage, newPage) {
  return pairs.find(pair => pair.oldPage === oldPage && pair.newPage === newPage) || null;
}

export function canConfirmSuggestedPair(pairs, oldPage, newPage) {
  return !pairs.some(pair => pair.oldPage === oldPage || pair.newPage === newPage);
}

export function adjacentConfirmedPair(pairs, oldPage, newPage, direction) {
  const index = pairs.findIndex(pair => pair.oldPage === oldPage && pair.newPage === newPage);
  return index < 0 ? null : pairs[index + direction] || null;
}
