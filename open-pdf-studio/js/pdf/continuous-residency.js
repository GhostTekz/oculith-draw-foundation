// Choose distant page surfaces to release while preserving pages in the
// observer's viewport margin and any page containing keyboard focus.
export function continuousPagesToRelease(pages, {
  maxPages = 8,
  maxBytes = 256 * 1024 * 1024,
  retainDistance = 0,
} = {}) {
  const protectedPages = pages.filter(page => page.inRange || page.focused);
  const candidates = pages.filter(page => !page.inRange && !page.focused)
    .sort((a, b) => a.distance - b.distance);
  let count = protectedPages.length;
  let bytes = protectedPages.reduce((sum, page) => sum + page.bytes, 0);
  const release = [];
  for (const page of candidates) {
    if (page.distance > retainDistance || count >= maxPages || bytes + page.bytes > maxBytes) {
      release.push(page.pageNum);
    } else {
      count++;
      bytes += page.bytes;
    }
  }
  return release;
}
