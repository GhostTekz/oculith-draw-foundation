// One page of pdf.js annotations → app models (moved out of loader.js so the
// Unflatten path and node tests use the same conversion without the loader's
// app imports).
import { convertPdfAnnotation } from './annotation-converter.js';
import { loadFileAttachmentContents } from './capture-load.js';
import { statusReplyFromPdfAnnotation, applyStatusReplies } from './status-replies.js';
import { commentReplyFromPdfAnnotation, applyCommentReplies } from './comment-replies.js';
import { resolveGroupLinks } from './correction-load.js';
import { voegAnnotatiesToe } from './annotaties-toevoegen.js';
import { hasDurableMarkupId, uniqueDurableMarkupId } from '../../annotations/durable-markup-id.js';
import { linkMarkupGroups } from '../markup-group-pdf.js';
import { onthoudExtBron } from '../ext-interop.js';

// Convert one batch of pdf.js annotations and push them to doc.annotations,
// detecting textbox-leader PolyLines (linked via IRT) and attaching them
// to their parent textbox instead of pushing a standalone annotation.
// Review-status replies (Text + /IRT + /State, issue #308) worden hier ook
// herkend: die worden NIET als losse sticky note gepusht maar als status
// op de doel-annotatie gezet. Een vervanging (invoegteken en doorhaling met
// /RT /Group, #508) wordt na de lus gekoppeld.
// De hele reeks gaat pas aan het eind, in één keer, in doc.annotations (zie
// annotaties-toevoegen.js): losse pushes lieten per annotatie alles opnieuw
// rekenen wat de lijst leest.
export async function convertAndPushAnnotations(annots, pageNum, viewport, stampImageMap, annotColorMap, doc) {
  const textboxByRect = new Map();
  const byPdfId = new Map();
  const pendingLeaders = [];
  const pendingStatuses = [];
  const pendingReplies = []; // Text + /IRT replies: threads in the Markups List
  const groepen = []; // /RT /Group-kinderen, zie resolveGroupLinks
  const nieuw = [];
  // File Attachment markups: their bytes (capture-load.js).
  await loadFileAttachmentContents(annots, doc?.pdfDoc);
  for (const annot of annots) {
    const statusReply = statusReplyFromPdfAnnotation(annot);
    if (statusReply) {
      pendingStatuses.push(statusReply);
      continue;
    }
    const commentReply = commentReplyFromPdfAnnotation(annot);
    if (commentReply) {
      pendingReplies.push({ ...commentReply, annot });
      continue;
    }
    const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (!converted) continue;
    if (converted.__textboxLeader) {
      pendingLeaders.push(converted);
      continue;
    }
    if (converted.type === 'textbox' && converted._pdfRectKey) {
      textboxByRect.set(converted._pdfRectKey, converted);
    }
    if (annot.id) byPdfId.set(annot.id, converted);
    if (annot.replyType === 'Group' && annot.inReplyTo) {
      groepen.push({ converted, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
    }
    nieuw.push(converted);
    // Sommige converters leveren EXTRA annotaties naast de hoofdannotatie
    // (bv. een legacy meerpunts-betonbalk die in losse tweepunts-balken
    // gesplitst wordt). Die worden hier mee-gepusht.
    if (Array.isArray(converted.__extraAnnotations)) {
      for (const extra of converted.__extraAnnotations) nieuw.push(extra);
      delete converted.__extraAnnotations;
    }
  }
  // Reserve every other annotation's model ID before accepting PDF shape IDs.
  // Take this snapshot only after all async conversions. Parallel page loads
  // publish synchronously below, so the later page sees the earlier IDs.
  // A reply whose markup is not on this page (or not a markup OcuDraw reads)
  // stays a note, as before threads existed.
  for (const orphan of applyCommentReplies(pendingReplies, byPdfId)) {
    const converted = await convertPdfAnnotation(orphan.annot, pageNum, viewport, stampImageMap, annotColorMap);
    // A reply is saved Hidden (reply-dicts.js); as a stand-alone note it shows.
    if (converted) delete converted.hidden;
    if (converted && !converted.__textboxLeader) nieuw.push(converted);
  }
  const usedIds = new Set(doc.annotations.map(ann => ann.id));
  // A later annotation in this page must not collide with an earlier shape.
  for (const ann of nieuw) if (!hasDurableMarkupId(ann.type)) usedIds.add(ann.id);
  for (const ann of nieuw) {
    if (hasDurableMarkupId(ann.type)) ann.id = uniqueDurableMarkupId(ann.id, usedIds);
  }
  for (const pl of pendingLeaders) {
    const parent = textboxByRect.get(pl.irtRectKey);
    if (parent) {
      if (!Array.isArray(parent.leaders)) parent.leaders = [];
      parent.leaders.push(pl.leader);
    }
  }
  for (const tb of textboxByRect.values()) delete tb._pdfRectKey;
  applyStatusReplies(pendingStatuses, byPdfId);
  // Vervangingen (#508): invoegteken + doorhaling, in beide richtingen.
  resolveGroupLinks(groepen, byPdfId);
  // Markup groups (/IRT + /RT /Group, name from /GroupNesting): groupId and
  // groupPath, see markup-group-pdf.js.
  linkMarkupGroups(groepen, byPdfId, nieuw);
  // How each the external editor markup looked when read: the saver keeps it untouched
  // while the model still matches (ext-interop.js).
  if (doc) onthoudExtBron(doc, nieuw);
  voegAnnotatiesToe(doc, nieuw);
}
