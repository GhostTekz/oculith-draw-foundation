function cleanLabel(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim() : '';
}

function pagesByLabel(labels, count) {
  const groups = new Map();
  for (let page = 1; page <= count; page++) {
    const label = cleanLabel(labels?.[page - 1]);
    if (!label) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(page);
  }
  return groups;
}

// Only an exact, unique embedded label on each side becomes a suggestion.
// Missing labels, duplicate labels, and unmatched sheets remain visible for
// manual review; page index is never used as an implicit fallback.
export function suggestPagePairsByLabel(oldLabels, oldCount, newLabels, newCount) {
  if (!Number.isSafeInteger(oldCount) || oldCount < 1 || !Number.isSafeInteger(newCount) || newCount < 1) {
    throw new Error('Both PDFs must contain pages.');
  }
  const oldGroups = pagesByLabel(oldLabels, oldCount);
  const newGroups = pagesByLabel(newLabels, newCount);
  const suggestions = [];
  const ambiguities = [];
  const matchedOld = new Set();
  const matchedNew = new Set();
  const ambiguousOld = new Set();
  const ambiguousNew = new Set();
  for (const [label, oldPages] of oldGroups) {
    const newPages = newGroups.get(label) || [];
    if (!newPages.length) continue;
    if (oldPages.length === 1 && newPages.length === 1) {
      suggestions.push({ label, oldPage: oldPages[0], newPage: newPages[0] });
      matchedOld.add(oldPages[0]);
      matchedNew.add(newPages[0]);
    } else {
      ambiguities.push({ label, oldPages, newPages });
      oldPages.forEach(page => ambiguousOld.add(page));
      newPages.forEach(page => ambiguousNew.add(page));
    }
  }
  const unmatched = (labels, count, matched, ambiguous) => Array.from({ length: count }, (_, index) => index + 1)
    .filter(page => !matched.has(page) && !ambiguous.has(page))
    .map(page => ({ page, label: cleanLabel(labels?.[page - 1]) }));
  return {
    suggestions, ambiguities,
    unmatchedOld: unmatched(oldLabels, oldCount, matchedOld, ambiguousOld),
    unmatchedNew: unmatched(newLabels, newCount, matchedNew, ambiguousNew),
    hasOldLabels: Array.isArray(oldLabels),
    hasNewLabels: Array.isArray(newLabels),
  };
}

export async function suggestPagePairsFromDocs(oldDoc, newDoc) {
  if (!oldDoc || !newDoc) throw new Error('Both comparison PDFs must be open.');
  const [oldLabels, newLabels] = await Promise.all([oldDoc.getPageLabels(), newDoc.getPageLabels()]);
  return suggestPagePairsByLabel(oldLabels, oldDoc.numPages, newLabels, newDoc.numPages);
}
