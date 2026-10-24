// Generate bookmarks from page labels in the open document: one top-level
// bookmark per page, titled with its label, in page order. It replaces the
// document's bookmarks as one undo step; Save writes them as the /Outlines
// (saver/bookmarks.js). Set Batch Link does the same for a set of files.

import { getActiveDocument } from '../core/state.js';
import { execute } from '../core/undo-manager.js';
import { readDocumentLabels } from './page-labels-app.js';
import { bookmarksFromLabels } from '../batch/set-link.js';

/** The labels of the active document, or null when it has none of its own. */
export async function activeDocumentLabels() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return null;
  const labels = await readDocumentLabels(doc);
  return labels.some((l, i) => l && l !== String(i + 1)) ? labels : null;
}

/** Replace the bookmarks; returns the number created, or 0 without labels. */
export async function generateBookmarksFromLabels() {
  const doc = getActiveDocument();
  const labels = await activeDocumentLabels();
  if (!labels || getActiveDocument() !== doc) return 0;
  const stamp = Date.now().toString(36);
  const created = bookmarksFromLabels(labels).map((bm) => ({ ...bm, id: `${bm.id}_${stamp}` }));
  const old = (doc.bookmarks || []).map((bm) => ({ ...bm }));
  doc.bookmarks = created.map((bm) => ({ ...bm }));
  execute({
    type: 'compound',
    commands: [
      ...(old.length ? [{ type: 'removeBookmark', bookmarks: old }] : []),
      ...created.map((bookmark) => ({ type: 'addBookmark', bookmark })),
    ],
  });
  const [{ markDocumentModified }, { updateBookmarksList }] = await Promise.all([
    import('../ui/chrome/tabs.js'), import('../ui/panels/bookmarks.js'),
  ]);
  markDocumentModified();
  updateBookmarksList();
  return created.length;
}
