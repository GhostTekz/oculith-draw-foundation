// One PDF.js getAnnotations() answer per page, shared by everyone who reads
// a page's annotations while it is on screen: the markup loader, the link
// and form layers and the appearance-render state.
//
// PDF.js does not keep the answer: each call rebuilds the data in its
// worker (with the text of every text-bearing appearance) and copies it
// back. On a sheet with thousands of markups that is more than a second a
// call, and the calls for one page queue behind each other in that worker.
//
// The answer depends only on the opened file, so it is kept per PDF.js
// document (a reopened or reloaded file is a new document) and per page,
// for the most recent pages only. Callers must not change what they get.

const MAX_PAGES = 16;

// PDF.js document transport → Map(page index → Promise<annotations[]>), in
// the order of last use.
const perDocument = new WeakMap();

function cacheOf(page) {
  const key = page?._transport;
  if (!key) return null;
  let cache = perDocument.get(key);
  if (!cache) { cache = new Map(); perDocument.set(key, cache); }
  return cache;
}

/**
 * `page.getAnnotations()` (display intent), asked of PDF.js once per page.
 * @param {object} page  PDFPageProxy
 * @returns {Promise<object[]>}
 */
export function pageAnnotations(page) {
  const cache = cacheOf(page);
  if (!cache) return page.getAnnotations();
  const index = page._pageIndex ?? (page.pageNumber - 1);
  let pending = cache.get(index);
  if (pending) {
    cache.delete(index);
    cache.set(index, pending);
    return pending;
  }
  pending = page.getAnnotations();
  cache.set(index, pending);
  // A failed read is asked again next time.
  pending.catch(() => { if (cache.get(index) === pending) cache.delete(index); });
  while (cache.size > MAX_PAGES) cache.delete(cache.keys().next().value);
  return pending;
}

/**
 * Keep `list` as the answer for `page` (an equal list read another way,
 * loader/own-markup-list.js), unless PDF.js was already asked: then that
 * answer stays. Returns the list to use.
 * @param {object} page  PDFPageProxy
 * @param {object[]} list
 * @returns {object[]}
 */
export function keepPageAnnotations(page, list) {
  const cache = cacheOf(page);
  if (!cache) return list;
  const index = page._pageIndex ?? (page.pageNumber - 1);
  if (!cache.has(index)) {
    cache.set(index, Promise.resolve(list));
    while (cache.size > MAX_PAGES) cache.delete(cache.keys().next().value);
  }
  return list;
}

/** Forget the kept answers of a PDF.js document (or of one page of it). */
export function forgetPageAnnotations(pdfDoc, pageNum) {
  const cache = pdfDoc?._transport && perDocument.get(pdfDoc._transport);
  if (!cache) return;
  if (pageNum == null) cache.clear();
  else cache.delete(pageNum - 1);
}
