// Search the fields the Markups List exposes. Words can match different
// columns, so "page 2 accepted" still finds the expected review row.
export function matchesMarkupSearch(annotation, query, preview = '', customValues = []) {
  const terms = String(query || '').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) return true;
  const fields = [
    `Page ${annotation.page}`, annotation.type, annotation.subject,
    annotation.author, annotation.status, preview, annotation.text, ...customValues,
  ];
  const haystack = fields.filter(value => value != null).map(value => String(value)).join(' ').toLocaleLowerCase();
  return terms.every(term => haystack.includes(term));
}
