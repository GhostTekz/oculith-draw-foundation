// Cursor position for the status bar: the page under the pointer and the
// pointer in page space (PDF points from the top left of the page, the space
// markups are stored in). Pointer moves are coalesced to one update per
// animation frame, and the signal only changes when the position does.
// The status bar turns it into units (navigation-format.js
// formatCursorCoords): calibrated lengths with a page scale, paper lengths
// without one.

import { createSignal } from 'solid-js';
import { state } from '../core/state.js';

const [cursorPoint, setCursorPoint] = createSignal(null);

export { cursorPoint };

let pending = null;
let frame = 0;
let pointerToAppCoords = null;

function pageUnderPointer(e, doc) {
  if (doc.viewMode !== 'continuous') return doc.currentPage || 1;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const wrapper = el?.closest?.('.page-wrapper');
  const page = parseInt(wrapper?.dataset?.page, 10);
  return Number.isFinite(page) ? page : null;
}

function update() {
  frame = 0;
  const e = pending;
  pending = null;
  if (!e) return;
  const doc = state.documents?.[state.activeDocumentIndex];
  const overPage = !!(e.target?.closest?.('#pdf-container') && doc?.pdfDoc && pointerToAppCoords);
  const page = overPage ? pageUnderPointer(e, doc) : null;
  const p = page ? pointerToAppCoords(e) : null;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    if (cursorPoint() !== null) setCursorPoint(null);
    return;
  }
  const cur = cursorPoint();
  if (cur && cur.page === page && Math.abs(cur.x - p.x) < 0.01 && Math.abs(cur.y - p.y) < 0.01) return;
  setCursorPoint({ page, x: p.x, y: p.y });
}

function onMove(e) {
  pending = e;
  if (!frame) frame = requestAnimationFrame(update);
}

function onLeave(e) {
  if (!e.relatedTarget) {
    pending = null;
    setCursorPoint(null);
  }
}

let installed = false;
/** Start tracking (idempotent). */
export function installCursorTracker() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  import('./g-move-mode.js').then((m) => { pointerToAppCoords = m.pointerToAppCoords; }).catch(() => {});
  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseout', onLeave, { passive: true });
}
