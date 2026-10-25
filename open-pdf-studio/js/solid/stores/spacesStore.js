// Spaces panel UI state: the selected space, outline visibility and the page
// filter. The canvas overlay (spaces/overlay.js) mirrors the first two.
import { createSignal } from 'solid-js';
import { lazyMemo } from './lazy-memo.js';
import { state } from '../../core/state.js';
import { collectSpaces, markupSpaceResolver } from '../../spaces/model.js';
import { setSelectedSpaceIdForView, setSpaceOutlinesVisible, spaceOutlinesVisible } from '../../spaces/overlay.js';

const [selectedSpaceId, setSelectedRaw] = createSignal(null);
const [outlinesShown, setOutlinesRaw] = createSignal(spaceOutlinesVisible());
const [pageFilter, setPageFilter] = createSignal('all');

function redraw() {
  const doc = state.documents[state.activeDocumentIndex];
  import('../../annotations/rendering.js').then((m) => {
    if (doc?.viewMode === 'continuous') m.redrawContinuous(true); else m.redrawAnnotations(true);
  }).catch(() => {});
}

export function selectSpace(id) {
  setSelectedRaw(id || null);
  setSelectedSpaceIdForView(id || null);
  redraw();
}

export function setOutlinesShown(on) {
  setOutlinesRaw(!!on);
  setSpaceOutlinesVisible(!!on);
  redraw();
}

/** Every space of the active document, nesting resolved (reactive). */
export const documentSpaces = lazyMemo(() => {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return [];
  // Read the stored list so a replaced array (undo, edit) re-runs this memo.
  void doc.spaces?.length;
  return collectSpaces(doc);
});

/** Markups per space id, counting sub-spaces too (reactive). */
export const spaceMarkupCounts = lazyMemo(() => {
  const doc = state.documents[state.activeDocumentIndex];
  const spaces = documentSpaces();
  const counts = new Map();
  if (!doc || !spaces.length) return counts;
  const resolve = markupSpaceResolver(doc);
  const byId = new Map(spaces.map((s) => [s.id, s]));
  for (const ann of doc.annotations || []) {
    if (ann.type === 'scaleRegion') continue;
    let s = resolve(ann);
    while (s) {
      counts.set(s.id, (counts.get(s.id) || 0) + 1);
      s = s.parent ? byId.get(s.parent) : null;
    }
  }
  return counts;
});

export { selectedSpaceId, outlinesShown, pageFilter, setPageFilter };
