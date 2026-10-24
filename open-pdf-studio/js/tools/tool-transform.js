import { getActiveDocument } from '../core/state.js';
import { viewportGeometrie, vermenigvuldig } from '../pdf/weergave-rotatie.js';
import { weergaveRotatie, weergaveTransform } from '../pdf/weergave-ruimte.js';

/**
 * Apply the correct canvas transform for drawing tool previews/interactions.
 * In viewport mode: viewport zoom + offset, times the overlay backing scale.
 * In legacy mode: uses doc.scale (with DPR handled elsewhere).
 * Call ctx.save() before and ctx.restore() after.
 */
export function applyToolTransform(ctx) {
  const doc = getActiveDocument();
  const vp = window.__pdfViewport;
  // Same blank-doc guard as resolvePointerCoords — blank in-memory docs
  // bypass the viewport singleton and use doc.scale via the PDF.js path.
  if (vp && vp.active && doc?.filePath) {
    // Zoom + verschuiving, en de weergaverotatie (#200) daaronder. The
    // overlay backing is device resolution (dataset.backingScale = dpr).
    const backing = parseFloat(ctx.canvas?.dataset?.backingScale);
    const k = Number.isFinite(backing) && backing > 0 ? backing : 1;
    ctx.setTransform(...vermenigvuldig([k, 0, 0, k, 0, 0], viewportGeometrie(vp).matrix));
  } else {
    const scale = doc?.scale || 1.5;
    const canvas = ctx.canvas;
    const backing = canvas?.dataset ? parseFloat(canvas.dataset.backingScale) : NaN;
    const dpr = Number.isFinite(backing) ? backing : (window.devicePixelRatio || 1);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    // Doorlopende weergave: het annotatiecanvas is een viewport-uitsnede van
    // de pagina; (clipX,clipY) is de positie van die uitsnede in CSS-px.
    const clipX = canvas?.dataset ? parseFloat(canvas.dataset.clipX) || 0 : 0;
    const clipY = canvas?.dataset ? parseFloat(canvas.dataset.clipY) || 0 : 0;
    if (clipX || clipY) ctx.translate(-clipX / scale, -clipY / scale);
    // Gedraaide weergave (#200): de pagina van dit canvas draaien.
    if (weergaveRotatie(doc)) {
      const pagina = parseInt(canvas?.dataset?.page, 10) || doc?.currentPage || 1;
      const m = weergaveTransform(pagina, doc);
      if (m) ctx.transform(...m);
    }
  }
}
