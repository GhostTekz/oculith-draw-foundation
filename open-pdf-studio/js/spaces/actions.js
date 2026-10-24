// Spaces panel actions on the active document. Stored spaces change through
// one undo step each (recordSpaces, undo-manager 'modifySpaces'); a
// floor-plan room is an annotation, so its name, colour and outline
// visibility change through the annotation (commitAnnotationMutation) and
// deleting it deletes the room and its tags.

import { getActiveDocument } from '../core/state.js';
import { recordSpaces, beginUndoTransaction, endUndoTransaction } from '../core/undo-manager.js';
import { commitAnnotationMutation, deleteAnnotationsWithUndo } from '../annotations/mutations.js';
import { ruimteNaamPatch, tagsVanRuimte, isRuimteVlak } from '../plattegrond/ruimte-koppeling.js';
import {
  collectSpaces, withSpaceAdded, withSpaceChanged, withSpaceRemoved, nextSpaceName, outlineOfMarkup,
  isRoomSpaceId, ROOM_SPACE_PREFIX, spaceName, spaceColor, spaceAt,
} from './model.js';
import { labelPunt } from '../plattegrond/ruimte.js';

async function refreshView() {
  const doc = getActiveDocument();
  try {
    // A full redraw also rebuilds the Markups List (its Space column).
    const m = await import('../annotations/rendering.js');
    if (doc?.viewMode === 'continuous') m.redrawContinuous(); else m.redrawAnnotations();
  } catch { /* no canvas (tests) */ }
}

function roomAnnotation(doc, id) {
  if (!isRoomSpaceId(id)) return null;
  const annId = id.slice(ROOM_SPACE_PREFIX.length);
  return (doc?.annotations || []).find((a) => String(a.id) === annId && isRuimteVlak(a)) || null;
}

function commitSpaces(doc, next) {
  const before = JSON.parse(JSON.stringify(doc.spaces || []));
  doc.spaces = next;
  recordSpaces(before, next);
  refreshView();
}

/**
 * Add a stored space from an outline (app page coordinates). Without a name
 * it is "Space N"; without a parent it nests by geometry.
 * @returns {string|null} the new space id
 */
export function addSpace({ page, points, name, color, parentId = null } = {}, doc = getActiveDocument()) {
  if (!doc) return null;
  const pg = Number(page) || doc.currentPage || 1;
  const current = Array.isArray(doc.spaces) ? doc.spaces : [];
  const all = collectSpaces(doc);
  const next = withSpaceAdded(current, {
    page: pg, points, parentId,
    name: spaceName(name) || nextSpaceName(all, pg),
    ...(color ? { color } : {}),
  });
  if (next.length === current.length) return null;
  commitSpaces(doc, next);
  return next[next.length - 1].id;
}

/**
 * Spaces from the selected markups: an area measurement, polygon, filled
 * area, rectangle or ellipse becomes a stored space with the same outline
 * (named after the measurement name or subject). Rooms already are spaces.
 * @returns {{ added: string[], rooms: number, skipped: number }}
 */
export function addSpacesFromSelection(doc = getActiveDocument()) {
  const out = { added: [], rooms: 0, skipped: 0 };
  if (!doc) return out;
  const picked = doc.selectedAnnotations?.length ? doc.selectedAnnotations : [doc.selectedAnnotation].filter(Boolean);
  let spaces = Array.isArray(doc.spaces) ? doc.spaces : [];
  const before = JSON.parse(JSON.stringify(spaces));
  for (const ann of picked) {
    if (isRuimteVlak(ann)) { out.rooms += 1; continue; }
    const points = outlineOfMarkup(ann);
    if (!points) { out.skipped += 1; continue; }
    const page = Number(ann.page) || 1;
    const name = spaceName(ann.measureName) || spaceName(ann.subject)
      || nextSpaceName(collectSpaces({ ...doc, spaces }), page);
    const next = withSpaceAdded(spaces, { page, points, name });
    if (next.length === spaces.length) { out.skipped += 1; continue; }
    spaces = next;
    out.added.push(next[next.length - 1].id);
  }
  if (out.added.length) {
    doc.spaces = spaces;
    recordSpaces(before, spaces);
    refreshView();
  }
  return out;
}

export function renameSpace(id, name, doc = getActiveDocument()) {
  const clean = spaceName(name);
  if (!doc || !clean) return false;
  const room = roomAnnotation(doc, id);
  if (room) {
    // One undo step for the room and the backup name on its tags
    // (the tags show the room's name, ruimte-koppeling tagWeergaveParams).
    beginUndoTransaction();
    try {
      commitAnnotationMutation(room, (a) => Object.assign(a, ruimteNaamPatch(clean)));
      for (const tag of tagsVanRuimte(room, doc.annotations)) {
        if (tag.params) commitAnnotationMutation(tag, (t) => { t.params = { ...t.params, naam: clean }; });
      }
    } finally {
      endUndoTransaction();
    }
    refreshView();
    return true;
  }
  if (!(doc.spaces || []).some((s) => s.id === id)) return false;
  commitSpaces(doc, withSpaceChanged(doc.spaces, id, { name: clean }));
  return true;
}

export function recolorSpace(id, color, doc = getActiveDocument()) {
  const clean = spaceColor(color, '');
  if (!doc || !clean) return false;
  const room = roomAnnotation(doc, id);
  if (room) {
    commitAnnotationMutation(room, (a) => { a.opsSpaceColor = clean; });
    refreshView();
    return true;
  }
  if (!(doc.spaces || []).some((s) => s.id === id)) return false;
  commitSpaces(doc, withSpaceChanged(doc.spaces, id, { color: clean }));
  return true;
}

export function setSpaceHidden(id, hidden, doc = getActiveDocument()) {
  if (!doc) return false;
  const room = roomAnnotation(doc, id);
  if (room) {
    commitAnnotationMutation(room, (a) => { if (hidden) a.opsSpaceHidden = true; else delete a.opsSpaceHidden; });
    refreshView();
    return true;
  }
  if (!(doc.spaces || []).some((s) => s.id === id)) return false;
  commitSpaces(doc, withSpaceChanged(doc.spaces, id, { hidden: !!hidden }));
  return true;
}

/** Parent of a stored space: another space id, or null for "by geometry". */
export function setSpaceParent(id, parentId, doc = getActiveDocument()) {
  if (!doc || isRoomSpaceId(id) || !(doc.spaces || []).some((s) => s.id === id)) return false;
  commitSpaces(doc, withSpaceChanged(doc.spaces, id, { parentId: parentId || null }));
  return true;
}

/** Delete a space. A room goes with its tags (one undo step). */
export function deleteSpace(id, doc = getActiveDocument()) {
  if (!doc) return false;
  const room = roomAnnotation(doc, id);
  if (room) {
    const gone = deleteAnnotationsWithUndo(doc, [room, ...tagsVanRuimte(room, doc.annotations)]);
    if (gone.length) {
      doc.selectedAnnotations = (doc.selectedAnnotations || []).filter((a) => !gone.includes(a));
      if (gone.includes(doc.selectedAnnotation)) doc.selectedAnnotation = null;
      refreshView();
    }
    return gone.length > 0;
  }
  if (!(doc.spaces || []).some((s) => s.id === id)) return false;
  commitSpaces(doc, withSpaceRemoved(doc.spaces, id));
  return true;
}

/** The space at a point of a page (for the space tools' hints and tests). */
export function spaceAtPoint(page, point, doc = getActiveDocument()) {
  return spaceAt(collectSpaces(doc), page, point);
}

/** Centre of a space for "go to": its label point. */
export function spaceFocusPoint(space) {
  return space?.label || (space?.points ? labelPunt(space.points) : null);
}
