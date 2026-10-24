/**
 * Format Painter (the external editor, Ctrl+Shift+C / ribbon): copy the appearance of one
 * markup onto others of the same type family (annotations/format-painter.js).
 *
 * Started with one markup selected, that markup is the source; otherwise the
 * first click picks it. Every further click on a markup paints it (one undo
 * step per markup). Esc ends, like every tool (keyboard-handlers.js).
 */
import { state, getActiveDocument } from '../../core/state.js';
import { canPaintFormat, formatPatch } from '../../annotations/format-painter.js';
import { isLayerEditable } from '../../annotations/annotatie-lagen.js';
import { updateStatusMessage } from '../../ui/chrome/status-bar.js';
import i18next from '../../i18n/config.js';

let source = null;

const say = (key, opts) => updateStatusMessage(i18next.t(`formatPainter.${key}`, { ns: 'statusbar', ...opts }));

/** The markup whose appearance is painted, or null while none is picked. */
export function formatPainterSource() {
  return source;
}

/** Start the Format Painter with the selection (one markup) as the source. */
export async function startFormatPainter() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const sel = [...(doc.selectedAnnotations || [])];
  const { setTool } = await import('../manager.js');
  setTool('formatPainter');
  if (state.currentTool !== 'formatPainter') return; // read-only document
  armFormatPainter(sel);
}

/** Take the source from a selection: one markup is the source, else none. */
export function armFormatPainter(selection) {
  source = selection?.length === 1 ? selection[0] : null;
  say(source ? 'pickTargets' : 'pickSource');
}

export const formatPainterTool = {
  name: 'formatPainter',
  cursor: 'copy',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    const hit = ctx.findAnnotationAt(ctx.x, ctx.y);
    if (!hit) return;
    const doc = getActiveDocument();
    if (!source || !doc?.annotations.includes(source)) {
      source = hit;
      doc.selectedAnnotations = [hit];
      doc.selectedAnnotation = hit;
      ctx.redraw();
      say('pickTargets');
      return;
    }
    if (hit === source) return;
    // A markup on a locked (or hidden) markup layer keeps its look, even if
    // a hit test hands it over.
    if (!isLayerEditable(doc, hit)) {
      say('locked');
      return;
    }
    if (!canPaintFormat(source, hit)) {
      say(hit.locked ? 'locked' : 'otherFamily');
      return;
    }
    const before = ctx.cloneAnnotation(hit);
    Object.assign(hit, formatPatch(source, hit), { modifiedAt: new Date().toISOString() });
    ctx.recordModify(hit.id, before, ctx.cloneAnnotation(hit));
    ctx.redraw();
  },

  onEscape() {
    source = null;
    return false;
  },

  onDeactivate() {
    source = null;
  },
};
