// Markup replies: the threaded comments under a markup in the Markups List.
//
// A reply is { id, author, text, createdAt }. It is saved as its own PDF Text
// annotation with /IRT to the markup and /RT /R (ISO 32000-1, 12.5.6.2), so
// other PDF programs show the same thread. No app imports here: the list,
// the summaries and the loader share these helpers, and Node tests run them.

export const REPLY_TEXT_MAX = 4000;

export function replyId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** A trimmed reply, or null for an empty one. */
export function newReply(text, author, now = new Date()) {
  const body = String(text ?? '').replace(/\r\n?/gu, '\n').trim().slice(0, REPLY_TEXT_MAX);
  if (!body) return null;
  return { id: replyId(), author: String(author || 'User'), text: body, createdAt: new Date(now).toISOString() };
}

function replyDate(reply) {
  return reply?.createdAt || reply?.date || reply?.modifiedAt || '';
}

/**
 * The replies of a markup in thread order (oldest first). Blank placeholder
 * replies, such as an empty one an older context menu added, are left out.
 */
export function markupReplies(annotation) {
  const replies = Array.isArray(annotation?.replies) ? annotation.replies : [];
  return replies
    .map((reply, index) => ({ reply, index }))
    .filter(({ reply }) => reply && String(reply.text ?? '').trim())
    .sort((a, b) => {
      const da = Date.parse(replyDate(a.reply));
      const db = Date.parse(replyDate(b.reply));
      if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
      return a.index - b.index;
    })
    .map(({ reply, index }) => ({
      id: String(reply.id || `reply-${index}`),
      author: reply.author || 'User',
      text: String(reply.text),
      createdAt: replyDate(reply),
    }));
}
