// Copy selected markups onto a page range at the same page coordinates.
// Each target page gets its own clones. A markup is not copied onto the
// page it already occupies. Sources are not changed. Groups are relinked
// by cloneAnnotationsInPlace, so each target page gets a new group id.

import { cloneAnnotationsInPlace } from './paste-in-place.js';

/**
 * @param {Array<Object>} sources  markups to copy; not mutated
 * @param {number[]} pages         1-based target pages
 * @param {Object} [opts]          forwarded to cloneAnnotationsInPlace
 * @param {Function} [opts.afterEach]  (source, clone) after each clone
 * @returns {Array<Object>}
 */
export function copiesForPages(sources, pages, opts = {}) {
  const list = (Array.isArray(sources) ? sources : []).filter(Boolean);
  const targets = Array.isArray(pages) ? pages : [];
  const out = [];
  for (const page of targets) {
    const batch = list.filter((source) => Number(source.page) !== Number(page));
    if (!batch.length) continue;
    const clones = cloneAnnotationsInPlace(batch, page, opts);
    if (typeof opts.afterEach === 'function') {
      for (let i = 0; i < clones.length; i++) opts.afterEach(batch[i], clones[i]);
    }
    out.push(...clones);
  }
  return out;
}
