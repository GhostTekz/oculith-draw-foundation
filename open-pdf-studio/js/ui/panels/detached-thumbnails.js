// The drawing window owns PDF rendering and the thumbnail cache. A separate
// view window receives only visible cached images and sends page navigation
// back here; it never opens a second copy of the drawing.
import { getActiveDocument } from '../../core/state.js';
import { cachedThumbnailForDocument, onDetachedThumbnailChange, setDetachedThumbnailRange } from './left-panel.js';

const STATE = 'thumbnail-view:state';
const IMAGES = 'thumbnail-view:images';
const READY = 'thumbnail-view:ready';
const RANGE = 'thumbnail-view:range';
const GOTO = 'thumbnail-view:goto';
const CLOSED = 'thumbnail-view:closed';
const MAX_RANGE = 24;
const MAX_IMAGES_PER_SYNC = 4;

let childLabel = '';
let sourceLabel = '';
let listeners = null;
let timer = null;
let ready = false;
let requested = { docId: '', start: 1, end: 12 };
let lastState = '';
let sentImages = new Map();
let sending = false;
let pendingSync = false;
let checks = 0;
let opening = null;

const tauri = () => window.__TAURI__;
const documentName = (doc) => String(doc?.filePath || doc?.name || 'Drawing')
  .split(/[\\/]/).pop() || 'Drawing';

function snapshot() {
  const doc = getActiveDocument();
  const count = doc?.pdfDoc?.numPages || 0;
  return { docId: count ? doc.id : '', count,
    activePage: count ? Math.max(1, Math.min(count, doc.currentPage || 1)) : 0,
    title: count ? documentName(doc) : '' };
}

function clearConnection() {
  if (timer) clearInterval(timer);
  timer = null;
  ready = false;
  lastState = '';
  sentImages = new Map();
  pendingSync = false;
  requested = { docId: '', start: 1, end: 12 };
  onDetachedThumbnailChange(null);
  setDetachedThumbnailRange(null, 0, 0);
}

async function sync(force = false) {
  if (!ready || !childLabel) return;
  if (sending) { pendingSync = true; return; }
  sending = true;
  try {
    const current = snapshot();
    const key = JSON.stringify(current);
    if (force || key !== lastState) {
      await tauri().event.emitTo(childLabel, STATE, { source: sourceLabel, ...current });
      if (current.docId !== requested.docId) {
        requested = { docId: current.docId, start: 1, end: 12 };
        sentImages = new Map();
        setDetachedThumbnailRange(current.docId, 1, 12);
      }
      lastState = key;
    }
    if (!current.docId) return;
    const changed = [];
    for (let page = requested.start; page <= Math.min(requested.end, current.count); page++) {
      const image = cachedThumbnailForDocument(current.docId, page);
      if (!image?.dataURL) {
        if (sentImages.has(page)) changed.push({ page, dataURL: null });
        continue;
      }
      if (sentImages.get(page) === image.dataURL) continue;
      changed.push({ page, dataURL: image.dataURL, width: image.width, height: image.height });
      if (changed.length >= MAX_IMAGES_PER_SYNC) break;
    }
    if (changed.length) {
      await tauri().event.emitTo(childLabel, IMAGES,
        { source: sourceLabel, docId: current.docId, pages: changed });
      for (const image of changed) {
        if (image.dataURL) sentImages.set(image.page, image.dataURL);
        else sentImages.delete(image.page);
      }
      if (changed.length === MAX_IMAGES_PER_SYNC) pendingSync = true;
    }
  } catch (error) {
    console.warn('[thumbnails] separate view update failed:', error);
  } finally {
    sending = false;
    if (pendingSync) {
      pendingSync = false;
      queueMicrotask(() => { void sync(); });
    }
  }
}

async function ensureListeners() {
  if (listeners) return listeners;
  listeners = (async () => {
    const event = tauri()?.event;
    if (!event?.listen || !event?.emitTo) throw new Error('A desktop window is required.');
    sourceLabel = await tauri().core.invoke('current_window_label');
    childLabel = `thumbnail-${sourceLabel}`;
    await event.listen(READY, (message) => {
      if (message.payload?.child !== childLabel) return;
      ready = true;
      lastState = '';
      sentImages = new Map();
      void sync(true);
    });
    await event.listen(RANGE, (message) => {
      const { child, docId, start, end } = message.payload || {};
      if (child !== childLabel || docId !== snapshot().docId
          || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
          || start < 1 || end < start || end - start >= MAX_RANGE) return;
      if (requested.docId === docId && requested.start === start && requested.end === end) return;
      requested = { docId, start, end };
      for (const page of sentImages.keys()) {
        if (page < start || page > end) sentImages.delete(page);
      }
      setDetachedThumbnailRange(docId, start, end);
      void sync();
    });
    await event.listen(GOTO, (message) => {
      const { child, docId, page } = message.payload || {};
      const current = snapshot();
      if (child !== childLabel || docId !== current.docId
          || !Number.isSafeInteger(page) || page < 1 || page > current.count) return;
      import('../../pdf/renderer.js').then(({ goToPage }) => goToPage(page))
        .then(() => tauri()?.window?.getCurrentWindow?.()?.setFocus?.())
        .catch((error) => console.warn('[thumbnails] page navigation failed:', error));
    });
    await event.listen(CLOSED, (message) => {
      if (message.payload?.child === childLabel) clearConnection();
    });
  })().catch((error) => { listeners = null; throw error; });
  return listeners;
}

function startWatchdog(W) {
  if (timer) return;
  checks = 0;
  timer = setInterval(() => {
    void sync();
    if (++checks % 2 === 0) {
      W.getByLabel(childLabel).then((found) => { if (!found) clearConnection(); }).catch(() => {});
    }
  }, 2000);
}

async function openView() {
  await ensureListeners();
  onDetachedThumbnailChange(() => { queueMicrotask(() => { void sync(); }); });
  const W = tauri()?.webviewWindow?.WebviewWindow;
  if (!W) throw new Error('A desktop window is required.');
  const existing = await W.getByLabel(childLabel);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    startWatchdog(W);
    if (!ready) { ready = true; void sync(true); }
    return;
  }
  const view = new W(childLabel, {
    url: `index.html?view=thumbnails&source=${encodeURIComponent(sourceLabel)}`,
    title: 'Thumbnails', width: 260, height: 680, minWidth: 200,
    minHeight: 280, resizable: true, decorations: true,
  });
  view.once('tauri://error', (event) => {
    console.warn('[thumbnails] separate view failed:', event);
    clearConnection();
  });
  startWatchdog(W);
}

/** Open or focus one view per drawing window. The source retains PDF ownership. */
export function openDetachedThumbnails() {
  if (!opening) opening = openView().finally(() => { opening = null; });
  return opening;
}
