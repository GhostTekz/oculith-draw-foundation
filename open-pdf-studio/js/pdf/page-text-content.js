// One PDF.js getTextContent() answer per page, shared by the readers of a
// page that is just opened: the text layer and the drawing-scale detection.
//
// On a dense drawing the call parses the whole content stream in the PDF.js
// worker, a second or more, and that worker answers nothing else meanwhile
// (the next sheet's getPage, the markups' getAnnotations). Two readers of the
// same page used to ask twice.
//
// The answer depends only on the opened file, so it is kept per PDF.js
// document (a reopened or reloaded file is a new document) and per page, for
// the last few pages only. Callers must not change what they get.

const MAX_PAGES = 3;

// PDF.js document transport → Map(page index → Promise<textContent>), in the
// order of last use.
const perDocument = new WeakMap();

function cacheOf(page) {
  const key = page?._transport;
  if (!key) return null;
  let cache = perDocument.get(key);
  if (!cache) { cache = new Map(); perDocument.set(key, cache); }
  return cache;
}

/**
 * `page.getTextContent()` (default options), asked of PDF.js once per page.
 * @param {object} page  PDFPageProxy
 * @returns {Promise<object>}
 */
export function pageTextContent(page) {
  const cache = cacheOf(page);
  if (!cache) return page.getTextContent();
  const index = page._pageIndex ?? (page.pageNumber - 1);
  let pending = cache.get(index);
  if (pending) {
    cache.delete(index);
    cache.set(index, pending);
    return pending;
  }
  pending = page.getTextContent();
  cache.set(index, pending);
  // A failed read is asked again next time.
  pending.catch(() => { if (cache.get(index) === pending) cache.delete(index); });
  while (cache.size > MAX_PAGES) cache.delete(cache.keys().next().value);
  return pending;
}
