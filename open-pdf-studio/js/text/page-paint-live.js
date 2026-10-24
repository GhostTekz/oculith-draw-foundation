// Keep #pdf-canvas in the document paint while text is selected or edited.
//
// isolation on #canvas-container plus mix-blend-mode on #text-highlight-canvas
// promotes the page canvas. WebKitGTK then shows that canvas's CSS background
// (white) for the whole focus or selection, and the bitmap only returns when
// the layer is torn down. html.pdf-text-live (styles/layout.css) drops both
// until the editor closes and the selection collapses. A one-shot redraw does
// not stick while the canvas stays composited. Do not promote #pdf-canvas,
// #pdf-detail-canvas, #annotation-canvas, or #text-highlight-canvas with
// translateZ or will-change.

export const PAGE_PAINT_LIVE_CLASS = 'pdf-text-live';
// Only while an editor is open. A zoomed text layer keeps an inline matrix
// that WebKitGTK uses to promote the page canvas; dropping it during a mere
// text selection would move the highlight.
export const PAGE_EDITOR_OPEN_CLASS = 'pdf-editor-open';

// rotate(0deg) still promotes a layer on WebKitGTK and blanks the page
// canvas for the whole edit. Omit that no-op. transform 'none' is not a
// layer; dropping the property matches the 0° editor path.
export function withoutFlatTransform(style) {
  if (!style || style.transform == null) return style;
  const t = String(style.transform).trim();
  const flat = t === 'none' || t === ''
    || /^rotate\(\s*[+-]?0+(?:\.0+)?deg\s*\)$/i.test(t);
  if (!flat) return style;
  const next = { ...style };
  delete next.transform;
  delete next['transform-origin'];
  return next;
}

const editors = new Set();
let listening = false;

export function setTextEditorPaint(source, open) {
  if (open) editors.add(source);
  else editors.delete(source);
  applyPagePaintLive();
}

function nodeElement(node) {
  if (!node) return null;
  if (node.nodeType === 1) return node;
  return node.parentElement || null;
}

function inTextLayer(node) {
  const el = nodeElement(node);
  return !!(el && typeof el.closest === 'function' && el.closest('.textLayer'));
}

export function textLayerHasSelection(selection) {
  const sel = selection ?? readSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  return inTextLayer(sel.anchorNode) || inTextLayer(sel.focusNode);
}

function readSelection() {
  if (typeof document === 'undefined') return null;
  try {
    return document.getSelection?.() ?? null;
  } catch {
    return null;
  }
}

function editorFocused() {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return false;
  if (el.isConnected === false) return false;
  const editable = !!el.isContentEditable || el.getAttribute?.('contenteditable') === 'true';
  if (!editable) return false;
  if (el.classList?.contains?.('inline-text-editor') || el.classList?.contains?.('pdf-text-editor')) return true;
  return typeof el.closest === 'function' && !!el.closest('.inline-text-editor, .pdf-text-editor');
}

export function pageEditorIsOpen() {
  return editors.size > 0 || editorFocused();
}

export function pagePaintIsLive() {
  return pageEditorIsOpen() || textLayerHasSelection();
}

export function applyPagePaintLive() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root?.classList?.toggle) return;
  root.classList.toggle(PAGE_PAINT_LIVE_CLASS, pagePaintIsLive());
  root.classList.toggle(PAGE_EDITOR_OPEN_CLASS, pageEditorIsOpen());
}

export function bindPagePaintLive() {
  if (listening || typeof document === 'undefined' || !document.addEventListener) return;
  listening = true;
  document.addEventListener('selectionchange', applyPagePaintLive);
  document.addEventListener('focusin', applyPagePaintLive, true);
  document.addEventListener('focusout', applyPagePaintLive, true);
}
