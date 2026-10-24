// Markup replies as PDF annotations (Markups List threads).
//
// Each reply is a Text annotation with /IRT to its markup and /RT /R
// (ISO 32000-1, 12.5.6.2), the markup's Rect, its author in /T and its date
// in /CreationDate and /M. It is flagged Hidden so readers that do not
// thread replies do not draw a loose note icon; readers that do (and the
// OcuDraw loader, loader/comment-replies.js) show it under its markup.

import { PDFName, PDFString } from 'pdf-lib';
import { pdfTextString } from './pdf-text.js';
import { markupReplies } from '../../annotations/markup-replies.js';
import { statusHistory, statusLabel } from '../../annotations/markup-status.js';

const HIDDEN_PRINT_NOZOOM_NOROTATE = 30;

function pdfDate(value) {
  const date = value ? new Date(value) : new Date();
  return PDFString.fromDate(isNaN(date.getTime()) ? new Date() : date);
}

/** Register one reply dict per non-empty reply; returns their refs in thread order. */
export function writeReplyDicts(context, parentRef, parentRect, annotation) {
  const refs = [];
  if (!parentRef) return refs;
  for (const reply of markupReplies(annotation)) {
    const dict = context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Contents: pdfTextString(reply.text),
      T: pdfTextString(reply.author || 'User'),
      M: pdfDate(reply.createdAt),
      CreationDate: pdfDate(reply.createdAt),
      F: HIDDEN_PRINT_NOZOOM_NOROTATE,
      Name: 'Comment',
    });
    if (parentRect) dict.set(PDFName.of('Rect'), parentRect);
    else dict.set(PDFName.of('Rect'), context.obj([0, 0, 0, 0]));
    dict.set(PDFName.of('IRT'), parentRef);
    dict.set(PDFName.of('RT'), PDFName.of('R'));
    refs.push(context.register(dict));
  }
  return refs;
}

/**
 * Register one review-status reply per status change (statusHistory), oldest
 * first: Text + /IRT + /State + /StateModel /Review, hidden. A markup whose
 * status was never set writes nothing.
 */
export function writeStatusReplyDicts(context, parentRef, parentRect, annotation, set = null) {
  const refs = [];
  if (!parentRef) return refs;
  for (const entry of statusHistory(annotation)) {
    const state = statusLabel(entry.state, set);
    const dict = context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Contents: pdfTextString(state),
      T: pdfTextString(entry.author || 'User'),
      M: pdfDate(entry.date),
      CreationDate: pdfDate(entry.date),
      F: HIDDEN_PRINT_NOZOOM_NOROTATE,
      State: pdfTextString(state),
      StateModel: PDFString.of('Review'),
    });
    dict.set(PDFName.of('Rect'), parentRect || context.obj([0, 0, 0, 0]));
    dict.set(PDFName.of('IRT'), parentRef);
    refs.push(context.register(dict));
  }
  return refs;
}
