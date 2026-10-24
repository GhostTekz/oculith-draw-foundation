// Follow a link to another PDF (/GoToR, as Set Batch Link writes them): open
// the file in a tab (or switch to it) and show the linked sheet. The path is
// relative to the PDF holding the link (remote-link.js). A PDF is untrusted
// input, so a link that leaves the folder of the current file, and of the
// current Set, opens only after the user agrees; that folder is then trusted
// for the rest of the session.

import { state, getActiveDocument } from '../core/state.js';
import { isTauri, fileExists, readBinaryFile, invoke, extractFileName } from '../core/platform.js';
import i18next from '../i18n/config.js';
import {
  resolveRelativePdfPath, directoryOf, isInsideDirectory, commonDirectory,
} from './remote-link.js';

const trustedFolders = new Set();

async function setRoot() {
  try {
    const { sheetRegister } = await import('../solid/stores/sheetRegisterStore.js');
    const paths = (sheetRegister()?.sheets || []).map((s) => s.filePath).filter(Boolean);
    return paths.length ? commonDirectory(paths) : '';
  } catch { return ''; }
}

async function status(key, options) {
  const { updateStatusMessage } = await import('../ui/chrome/status-bar.js');
  updateStatusMessage(i18next.t(`setBatchLink.follow.${key}`, { ns: 'common', ...options }), 5000);
}

async function confirmOutside(path) {
  const message = i18next.t('setBatchLink.follow.confirmOutside', { ns: 'common', path });
  const title = i18next.t('setBatchLink.follow.title', { ns: 'common' });
  if (window.__TAURI__?.dialog?.ask) return window.__TAURI__.dialog.ask(message, { title, kind: 'warning' });
  return confirm(message);
}

/** Where the linked file is, or null (with a status message) when it cannot be opened. */
async function locate(base, file) {
  if (!isTauri()) {
    // The browser build only has the files picked in this session, by name.
    for (const name of [resolveRelativePdfPath(base, file), extractFileName(file)]) {
      if (name && (await readBinaryFile(name))?.length) return name;
    }
    await status('notInBrowser', { file: extractFileName(file) });
    return null;
  }
  const path = resolveRelativePdfPath(base, file);
  if (!path) { await status('unsafe', { file }); return null; }
  const baseDir = directoryOf(base);
  const root = await setRoot();
  const inside = [baseDir, ...(root && isInsideDirectory(base, root) ? [root] : []), ...trustedFolders]
    .some((dir) => dir && isInsideDirectory(path, dir));
  if (!inside) {
    if (!(await confirmOutside(path))) return null;
    const shared = commonDirectory([base, path]);
    if (shared) trustedFolders.add(shared);
  }
  try { await invoke('allow_fs_scope', { path }); } catch { /* scope already granted */ }
  if (!(await fileExists(path).catch(() => false))) { await status('missing', { path }); return null; }
  return path;
}

/**
 * Open `target` ({ file, page } or { file, dest }, from parseRemotePdfLink)
 * relative to the active document. Returns true when the sheet is shown.
 */
export async function openRemotePdfLink(target) {
  const doc = getActiveDocument();
  if (!doc || !target?.file) return false;
  const path = await locate(doc.filePath || '', target.file);
  if (!path) return false;
  try {
    const [{ createTab }, { loadPDFIfNeeded }, { goToPage }] = await Promise.all([
      import('../ui/chrome/tabs.js'), import('./loader.js'), import('./renderer.js'),
    ]);
    const { index } = createTab(path);
    await loadPDFIfNeeded(path, index);
    const opened = state.documents[index];
    if (!opened?.pdfDoc) { await status('failed', { file: extractFileName(path) }); return false; }
    if (target.dest) {
      const { handleInternalLink } = await import('./link-layer.js');
      await handleInternalLink(target.dest);
      return true;
    }
    await goToPage(Math.min(Math.max(1, target.page || 1), opened.pdfDoc.numPages));
    return true;
  } catch (error) {
    console.warn('[remote-link] Could not open the linked file:', error);
    await status('failed', { file: extractFileName(path) });
    return false;
  }
}
