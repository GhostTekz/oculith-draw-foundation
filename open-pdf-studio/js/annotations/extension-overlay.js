// Optional annotation-canvas overlays supplied by an edition or tool. They
// draw transient UI only; nothing is added to the PDF or undo history.
const renderers = new Set();

export function addExtensionOverlay(renderer) {
  if (typeof renderer !== 'function') throw new TypeError('An overlay renderer is required.');
  renderers.add(renderer);
  return () => renderers.delete(renderer);
}

export function drawExtensionOverlays(ctx, pageNumber) {
  for (const renderer of renderers) {
    ctx.save();
    try { renderer(ctx, pageNumber); }
    finally { ctx.restore(); }
  }
}
