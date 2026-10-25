// The slots of a document's markups per page, for code that works on one
// page: scanning the whole flat list for each page (each visible page in the
// continuous view, each frame) is O(all markups) per page, through the
// store's proxies. Built from the raw objects and kept until a markup is
// added, removed, reordered or moved to another page.

import { $RAW } from 'solid-js/store';

const raw = (value) => (value && value[$RAW]) || value;
const cache = new WeakMap(); // raw array -> { token, byPage }

// Count and every markup's page, in slot order: a page move or a reorder
// changes it. Raw reads only, so cheap next to the scan it saves.
function pagesToken(list) {
  let h = Math.imul(0x811c9dc5 ^ list.length, 0x01000193) >>> 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const p = a && typeof a.page === 'number' ? a.page : -1;
    h = Math.imul(h ^ (p + 7), 0x01000193) >>> 0;
    const id = a && a.id;
    if (typeof id === 'string' && id.length) h = Math.imul(h ^ id.charCodeAt(id.length - 1) ^ (id.length << 8), 0x01000193) >>> 0;
  }
  return h;
}

/** Slots (indices into `annotations`) of the markups on `page`, in paint order. */
export function pageSlots(annotations, page) {
  const list = raw(annotations) || [];
  const token = pagesToken(list);
  let entry = cache.get(list);
  if (!entry || entry.token !== token) {
    const byPage = new Map();
    for (let i = 0; i < list.length; i++) {
      const p = list[i]?.page;
      let slots = byPage.get(p);
      if (!slots) { slots = []; byPage.set(p, slots); }
      slots.push(i);
    }
    entry = { token, byPage };
    cache.set(list, entry);
  }
  return entry.byPage.get(page) || [];
}
