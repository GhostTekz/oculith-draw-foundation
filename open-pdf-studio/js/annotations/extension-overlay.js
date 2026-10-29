// Optional annotation-canvas overlays supplied by an edition or tool. They
// draw transient UI only; nothing is added to the PDF or undo history.
const renderers = new Set();
const underlays = new Set();
const MAX_UNDERLAYS = 32;

// Read-only page decoration behind markups. The editor owns the canvas and
// restores its transform/style after each contribution. PDF output never runs
// this UI pass.
export function addExtensionUnderlay(renderer) {
  if (typeof renderer !== 'function') throw new TypeError('An underlay renderer is required.');
  if (!underlays.has(renderer) && underlays.size >= MAX_UNDERLAYS) throw new Error('Too many underlay renderers.');
  underlays.add(renderer);
  return () => underlays.delete(renderer);
}

export function drawExtensionUnderlays(ctx, pageNumber, doc) {
  for (const renderer of underlays) {
    ctx.save();
    try {
      // Keep a contributed drawing within the visible canvas even when the
      // caller's page-to-screen transform includes pan, zoom or rotation.
      const pageTransform = ctx.getTransform();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.clip();
      ctx.setTransform(pageTransform);
      renderer(ctx, pageNumber, doc);
    }
    catch (error) { console.warn('[render] extension underlay failed', error); }
    finally { ctx.restore(); }
  }
}

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
