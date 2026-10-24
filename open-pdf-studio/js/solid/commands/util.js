// Shared conditions and helpers for the command modules (file.js, edit.js,
// ...). Kept free of heavy imports so the registry, the menus and the command
// palette load under node for the unit tests: work that needs the renderer,
// the canvas or a dialog is imported lazily inside run().

import { state } from '../../core/state.js';
import { notifyCommandsChanged } from './registry.js';

export const activeDoc = () => state.documents[state.activeDocumentIndex];
export const hasPdf = () => !!activeDoc()?.pdfDoc;
// Same rule as isPdfAReadOnly() in pdf/loader.js (PDF/A opened read-only
// until the user dismisses the bar); repeated here so this module does not
// pull in the PDF loader.
export const pdfaReadOnly = () => {
  const d = activeDoc();
  return !!d && !!d.pdfaCompliance && !d.pdfADismissed;
};
/** An open PDF that may be changed. */
export const editable = () => hasPdf() && !pdfaReadOnly();
export const selection = () => activeDoc()?.selectedAnnotations || [];
export const hasSelection = () => selection().length > 0;
export const currentPage = () => activeDoc()?.currentPage || 1;
export const pageCount = () => activeDoc()?.pdfDoc?.numPages || 0;
export const isTool = (name) => state.currentTool === name;

/**
 * A getter for a module that is too heavy (or JSX) to import statically.
 * The first call starts the import; until it resolves the getter returns
 * null, then notifyCommandsChanged() refreshes open menus. Under node the
 * import may fail; the getter then stays null.
 */
export function lazyModule(loader) {
  let mod = null;
  let started = false;
  return () => {
    if (!started) {
      started = true;
      Promise.resolve().then(loader).then((m) => { mod = m; notifyCommandsChanged(); }).catch(() => {});
    }
    return mod;
  };
}

/** Redraw the annotation layer in the current view mode. */
export async function redrawView() {
  const m = await import('../../annotations/rendering.js');
  if (activeDoc()?.viewMode === 'continuous') m.redrawContinuous();
  else m.redrawAnnotations();
}

/** setTool(name), loaded lazily. */
export const useTool = (name) => import('../../tools/manager.js').then((m) => m.setTool(name));

/** Run fn(ann) for each selected annotation as one undo step. */
export async function modifySelection(fn) {
  const anns = [...selection()];
  if (!anns.length) return;
  const [{ cloneAnnotation }, { recordBulkModify }] = await Promise.all([
    import('../../annotations/factory.js'), import('../../core/undo-manager.js'),
  ]);
  const originals = anns.map((a) => cloneAnnotation(a));
  for (const ann of anns) fn(ann);
  recordBulkModify(anns, originals);
}

/** Yes/no question: the Tauri dialog when present, else window.confirm. */
export async function ask(message, title) {
  if (window.__TAURI__?.dialog?.ask) return window.__TAURI__.dialog.ask(message, { title, kind: 'warning' });
  return confirm(message);
}
