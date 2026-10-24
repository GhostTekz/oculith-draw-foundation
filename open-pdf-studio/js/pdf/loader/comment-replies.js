// Comment replies (Markups List threads).
//
// A reply in a PDF is a markup annotation with /IRT to the markup it answers
// and /RT /R (or no /RT, the default), ISO 32000-1 12.5.6.2. OcuDraw writes
// them as Text annotations; the external editor and other PDF programs do the same. Without
// this module the loader turned every reply into a loose sticky note.
// A reply with /State is a review-status reply (status-replies.js), and /RT
// /Group links a correction pair (correction-load.js); neither is handled here.
//
// No app imports, so the logic runs under Node tests.

function toIsoDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('D:')) {
    const s = raw.substring(2);
    const iso = `${s.substring(0, 4)}-${s.substring(4, 6) || '01'}-${s.substring(6, 8) || '01'}T`
      + `${s.substring(8, 10) || '00'}:${s.substring(10, 12) || '00'}:${s.substring(12, 14) || '00'}Z`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * A plain reply in a PDF.js annotation, or null.
 * @returns {null | {targetId, reply: {id, author, text, createdAt}}}
 */
export function commentReplyFromPdfAnnotation(annot) {
  if (!annot || annot.subtype !== 'Text' || !annot.inReplyTo) return null;
  if (annot.state) return null;
  if (annot.replyType && annot.replyType !== 'R') return null;
  const text = (annot.contentsObj && annot.contentsObj.str) || annot.contents || '';
  return {
    targetId: annot.inReplyTo,
    reply: {
      id: `pdf-${String(annot.id || '').replace(/[^\w-]/gu, '') || Math.random().toString(36).slice(2, 9)}`,
      author: (annot.titleObj && annot.titleObj.str) || annot.title || 'User',
      text: String(text),
      createdAt: toIsoDate(annot.creationDate) || toIsoDate(annot.modificationDate) || '',
    },
  };
}

/**
 * Attach replies to the markups they answer. A reply to a reply joins the
 * thread of the first markup. Replies whose markup is not among the loaded
 * markups are returned, so the caller can keep them as notes.
 *
 * @param {Array} pending  results of commentReplyFromPdfAnnotation(), each with `annot`
 * @param {Map<string, object>} byPdfId  PDF.js annotation id -> app annotation
 * @returns {Array} the pending entries that found no markup
 */
export function applyCommentReplies(pending, byPdfId) {
  if (!pending?.length) return [];
  const byReplyId = new Map(pending.filter(p => p.annot?.id).map(p => [p.annot.id, p]));
  const rootOf = (entry) => {
    let target = entry.targetId;
    const seen = new Set();
    while (!byPdfId.has(target) && byReplyId.has(target) && !seen.has(target)) {
      seen.add(target);
      target = byReplyId.get(target).targetId;
    }
    return byPdfId.get(target) || null;
  };
  const orphans = [];
  for (const entry of pending) {
    const parent = rootOf(entry);
    if (!parent) { orphans.push(entry); continue; }
    if (!Array.isArray(parent.replies)) parent.replies = [];
    parent.replies.push(entry.reply);
  }
  return orphans;
}
