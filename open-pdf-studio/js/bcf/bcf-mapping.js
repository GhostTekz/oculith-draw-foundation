// Pure mapping between the app annotation model and BCF 2.1 "topics".
//
// One annotation maps to one BCF topic:
//
//   annotation.subject      → Topic/Title
//   annotation.text         → Topic/Description   (falls back to subject)
//   annotation.author       → Topic/CreationAuthor
//   annotation.createdAt    → Topic/CreationDate
//   annotation.modifiedAt   → Topic/ModifiedDate
//   annotation.status       → Topic/@TopicStatus  (see status maps below)
//   annotation.priority     → Topic/Priority      (only if present)
//   annotation.replies[]    → Markup/Comment[]
//   annotation.type         → a Topic/Labels entry ("type:<t>")
//   annotation.page         → a Topic/Labels entry ("page:<n>") + snapshot page
//
// BCF viewpoints are 3D (camera + selected components). This app is a 2D PDF
// editor, so — as documented in the design note — the viewpoint is reduced to
// a per-topic PNG snapshot plus the PDF page number; no 3D camera is written.
// For lossless round-tripping of geometry/appearance we additionally embed a
// private `markup-opds.json` next to each topic (ignored by other tools).
//
// Pure module: no browser/app imports, unit-testable under Node.

// App status (properties panel) → BCF TopicStatus for external readability.
const STATUS_TO_BCF = {
  accepted: 'Closed',
  rejected: 'Closed',
  cancelled: 'Closed',
  completed: 'Closed',
  reviewed: 'Closed',
};

// BCF TopicStatus → app status, for topics coming from other tools.
const BCF_TO_STATUS = {
  open: undefined,
  'in progress': undefined,
  inprogress: undefined,
  reopened: undefined,
  're-opened': undefined,
  active: undefined,
  closed: 'completed',
  resolved: 'completed',
};

export function statusToBcf(status) {
  if (!status || status === 'none') return 'Open';
  return STATUS_TO_BCF[status] || 'Open';
}

export function bcfToStatus(topicStatus) {
  if (!topicStatus) return undefined;
  return BCF_TO_STATUS[String(topicStatus).toLowerCase().trim()];
}

export function genGuid() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  // RFC-4122 v4 fallback.
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

// A readable fallback title when the annotation has no subject/text.
const TYPE_TITLES = {
  comment: 'Comment', textbox: 'Text note', callout: 'Callout',
  highlight: 'Highlight', textHighlight: 'Highlight',
  box: 'Rectangle', circle: 'Ellipse', line: 'Line', arrow: 'Arrow',
  draw: 'Freehand', polygon: 'Polygon', cloud: 'Cloud',
  measureDistance: 'Distance measurement', measureArea: 'Area measurement',
  measurePerimeter: 'Perimeter measurement', measureAngle: 'Angle measurement',
  stamp: 'Stamp', parametricSymbol: 'Symbol',
};

function defaultTitle(ann) {
  return TYPE_TITLES[ann.type] || (ann.type ? `${ann.type} annotation` : 'Issue');
}

/**
 * Convert an app annotation into a normalized BCF topic object.
 * @param {object} ann
 * @returns {object} topic
 */
export function annotationToTopic(ann) {
  const now = new Date().toISOString();
  const title = (ann.subject && ann.subject.trim())
    || (ann.text && ann.text.trim())
    || (ann.measureText && ann.measureText.trim())
    || defaultTitle(ann);

  // Description: the annotation body text when it differs from the title.
  let description = '';
  if (ann.text && ann.text.trim() && ann.text.trim() !== title) description = ann.text.trim();
  else if (ann.measureText && ann.measureText.trim() && ann.measureText.trim() !== title) description = ann.measureText.trim();

  const labels = [];
  if (ann.type) labels.push(`type:${ann.type}`);
  if (ann.page) labels.push(`page:${ann.page}`);
  if (ann.marked) labels.push('marked');

  const comments = Array.isArray(ann.replies) ? ann.replies.map(r => ({
    guid: genGuid(),
    date: r.createdAt || now,
    author: r.author || ann.author || 'User',
    comment: r.text || '',
  })) : [];

  return {
    guid: genGuid(),
    topicType: 'Issue',
    topicStatus: statusToBcf(ann.status),
    title,
    priority: ann.priority || undefined,
    labels,
    creationDate: ann.createdAt || now,
    creationAuthor: ann.author || 'User',
    modifiedDate: ann.modifiedAt || undefined,
    description,
    comments,
    page: ann.page || 1,
    // Private, lossless payload for our own round-trip.
    annotation: ann,
  };
}

/**
 * Convert a parsed BCF topic back into an app annotation object.
 * When the private opds payload is present the original annotation is restored
 * verbatim (with refreshed metadata); otherwise a `comment` annotation is
 * synthesised on the topic's page carrying title/description/status/replies.
 * @param {object} topic  normalized topic (see parseMarkup output)
 * @param {number} pageCount  page count of the target document (for clamping)
 * @returns {object} annotation
 */
export function topicToAnnotation(topic, pageCount = Infinity) {
  const now = new Date().toISOString();
  const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 11);

  const replies = (topic.comments || []).map(c => ({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    author: c.author || 'User',
    text: c.comment || '',
    createdAt: c.date || now,
  }));

  if (topic.annotation && typeof topic.annotation === 'object') {
    // Lossless path — our own BCF.
    const ann = { ...topic.annotation };
    ann.id = newId;
    if (Array.isArray(replies) && replies.length) {
      // Replies parsed from markup are authoritative (description excluded).
      ann.replies = replies.filter(r => r.text && r.text.trim());
      if (ann.replies.length === 0) delete ann.replies;
    }
    if (ann.page) ann.page = Math.min(Math.max(1, ann.page), pageCount === Infinity ? ann.page : pageCount);
    ann.subject = topic.title || ann.subject || '';
    ann.status = bcfToStatus(topic.topicStatus) ?? ann.status;
    if (topic.priority) ann.priority = topic.priority;
    return ann;
  }

  // Defensive path — external BCF without our payload. Synthesise a comment
  // marker placed near the top-left of the referenced page.
  let page = topic.page || 1;
  if (pageCount !== Infinity) page = Math.min(Math.max(1, page), pageCount);

  const bodyParts = [];
  if (topic.description) bodyParts.push(topic.description);
  const text = bodyParts.join('\n\n');

  return {
    id: newId,
    type: 'comment',
    page,
    author: topic.creationAuthor || 'User',
    subject: topic.title || 'Imported issue',
    text: text || topic.title || '',
    createdAt: topic.creationDate || now,
    modifiedAt: topic.modifiedDate || topic.creationDate || now,
    x: 40, y: 40, width: 24, height: 24,
    color: '#ffd400', fillColor: '#ffd400',
    icon: 'comment',
    opacity: 1, locked: false, printable: true, readOnly: false, marked: false,
    status: bcfToStatus(topic.topicStatus),
    priority: topic.priority || undefined,
    replies: replies.length ? replies : undefined,
  };
}
