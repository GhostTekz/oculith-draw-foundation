/**
 * File Attachment (the external editor Tools ▸ File Attachment, F): click to place a push
 * pin, then pick any file; the pin carries the file (a /FileAttachment
 * annotation, saver/capture-files.js). Double-click opens or saves it.
 */
import { getActiveDocument, state as appState } from '../../core/state.js';
import { FILE_ATTACHMENT_ICON, FILE_ATTACHMENT_SIZE } from '../../annotations/capture.js';

const revertToSelect = () =>
  import('../manager.js').then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());

export const fileAttachmentTool = {
  name: 'fileAttachment',
  cursor: 'crosshair',
  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    ctx.state.isDrawing = true;
  },
  onPointerUp(ctx) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;
    const doc = getActiveDocument();
    const page = ctx.pageNum || doc?.currentPage || 1;
    const x = state.startX;
    const y = state.startY;
    import('../../annotations/capture-actions.js').then(async ({ pickAttachmentFile, bumpCapture }) => {
      const file = await pickAttachmentFile();
      if (!file || getActiveDocument() !== doc) { revertToSelect(); return; }
      const color = appState.preferences?.fileAttachmentColor || '#2563EB';
      const ann = ctx.createAnnotation({
        type: 'comment', page, x, y, width: FILE_ATTACHMENT_SIZE, height: FILE_ATTACHMENT_SIZE,
        // The comment shows the file name, as in the external editor (also /Contents in the PDF).
        text: file.name, icon: FILE_ATTACHMENT_ICON, color, fillColor: color, popupOpen: false,
        attachedFile: file,
      });
      doc.annotations.push(ann);
      ctx.recordAdd(ann);
      doc.selectedAnnotations = [ann];
      doc.selectedAnnotation = ann;
      ctx.redraw();
      ctx.showProperties(ann);
      bumpCapture();
      revertToSelect();
    }).catch(err => console.error('[fileAttachment] place failed', err));
    return true;
  },
  onDeactivate(ctx) {
    ctx.state.isDrawing = false;
  },
};
