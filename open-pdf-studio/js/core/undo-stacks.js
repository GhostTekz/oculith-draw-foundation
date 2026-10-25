// Undo and redo history of each document, kept outside the reactive store.
//
// A command holds annotation clones (a bulk or page-structure step holds a
// whole page's or document's worth). Inside the createMutable store every
// push ran a deep unwrap of the command, every read handed out proxies that
// stayed cached on the command objects, and every tracked read kept a signal
// node. The stacks are plain arrays in a WeakMap keyed by the raw document
// object, so a closed document still lets go of its history.
//
// Reactive readers (Undo/Redo enabled, the Undo History list) go through
// trackUndoHistory()/undoDepth()/redoDepth(), backed by one small version
// signal that every change to a stack bumps. The clean point
// (doc.savedUndoStackLength) and doc.modified stay in the store.
//
// For callers that still read doc.undoStack / doc.redoStack, the raw document
// gets a non-enumerable accessor that reads and writes these same arrays.
// Editor code uses the functions below. Assigning doc.undoStack through the
// store proxy would also leave a store signal holding that array, so the
// stacks are emptied in place and keep their identity.

import { createSignal } from 'solid-js';
import { $RAW } from 'solid-js/store';

const histories = new WeakMap();
const [historyVersion, setHistoryVersion] = createSignal(0, { equals: false });

/** The raw object behind a store proxy (the value itself otherwise). */
export function rawOf(value) {
  return (value && typeof value === 'object' && value[$RAW]) || value;
}

function asStack(value) {
  return Array.isArray(value) ? rawOf(value) : [];
}

function defineAccessor(raw, key, history, side) {
  try {
    Object.defineProperty(raw, key, {
      configurable: true,
      enumerable: false,
      get: () => history[side],
      set: (value) => { history[side] = asStack(value); historyChanged(); },
    });
  } catch { /* a sealed object keeps its own field */ }
}

function historyOf(doc) {
  const raw = rawOf(doc);
  let history = histories.get(raw);
  if (history) return history;
  // A document literal may still carry its own arrays (createDocument() of
  // an older caller, a test fixture): adopt them.
  history = { undo: asStack(raw.undoStack), redo: asStack(raw.redoStack) };
  histories.set(raw, history);
  defineAccessor(raw, 'undoStack', history, 'undo');
  defineAccessor(raw, 'redoStack', history, 'redo');
  return history;
}

/** Give a new document its (empty) history before it enters the store. */
export function attachUndoHistory(doc) {
  if (doc && typeof doc === 'object') historyOf(doc);
  return doc;
}

/** The document's undo stack (oldest first). Not reactive. */
export function undoStackOf(doc) {
  return doc ? historyOf(doc).undo : [];
}

/** The document's redo stack (the last entry is the next redo). Not reactive. */
export function redoStackOf(doc) {
  return doc ? historyOf(doc).redo : [];
}

/** Call after changing a stack in place (push, pop, shift, splice). */
export function historyChanged() {
  setHistoryVersion(0);
}

/** Empty the redo stack (a new edit). In place: the array stays the same. */
export function clearRedoStack(doc) {
  if (!doc) return;
  historyOf(doc).redo.length = 0;
  historyChanged();
}

/** Empty both stacks (a reload or a closed document). In place as well. */
export function clearUndoHistory(doc) {
  if (!doc) return;
  const history = historyOf(doc);
  history.undo.length = 0;
  history.redo.length = 0;
  historyChanged();
}

/** Subscribe the running computation to every history change. */
export function trackUndoHistory() {
  historyVersion();
}

/** Undo depth, reactive. */
export function undoDepth(doc) {
  historyVersion();
  return doc ? historyOf(doc).undo.length : 0;
}

/** Redo depth, reactive. */
export function redoDepth(doc) {
  historyVersion();
  return doc ? historyOf(doc).redo.length : 0;
}
