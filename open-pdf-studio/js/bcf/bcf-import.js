// Pure BCF 2.1 import: .bcfzip bytes → { topics, annotations }.
//
// Reads each `{guid}/markup.bcf`, restores the private `markup-opds.json`
// payload when present (lossless round-trip of our own exports), and otherwise
// synthesises a comment annotation from the topic's title/description/status
// (defensive path for BCF produced by other tools).
//
// Pure module (no browser/app imports), unit-testable under Node.

import { unzip } from './bcf-zip.js';
import { parseXml, child, children, childText, localName } from './bcf-xml.js';
import { topicToAnnotation } from './bcf-mapping.js';

const textDecoder = new TextDecoder();

function parseMarkup(xml, opdsPayload) {
  const root = parseXml(xml);
  if (localName(root.name) !== 'Markup') {
    throw new Error('markup.bcf root element is not <Markup>');
  }
  const topicEl = child(root, 'Topic');
  if (!topicEl) throw new Error('markup.bcf has no <Topic>');

  const labels = children(topicEl, 'Labels').map(l => l.text.trim()).filter(Boolean);

  // Page hint: prefer the opds payload, else a "page:N" label, else 1.
  let page = opdsPayload?.page || null;
  if (!page) {
    const lbl = labels.find(l => /^page:\s*\d+$/i.test(l));
    if (lbl) page = parseInt(lbl.split(':')[1], 10);
  }

  const comments = children(root, 'Comment').map(c => ({
    guid: c.attrs.Guid || '',
    date: childText(c, 'Date'),
    author: childText(c, 'Author'),
    comment: childText(c, 'Comment'),
  }));

  return {
    guid: topicEl.attrs.Guid || '',
    topicType: topicEl.attrs.TopicType || 'Issue',
    topicStatus: topicEl.attrs.TopicStatus || '',
    title: childText(topicEl, 'Title'),
    priority: childText(topicEl, 'Priority') || undefined,
    labels,
    creationDate: childText(topicEl, 'CreationDate'),
    creationAuthor: childText(topicEl, 'CreationAuthor'),
    modifiedDate: childText(topicEl, 'ModifiedDate') || undefined,
    description: childText(topicEl, 'Description'),
    comments,
    page: page || 1,
    annotation: opdsPayload?.annotation || null,
  };
}

/**
 * Parse a .bcfzip archive into topics and annotation objects.
 * @param {Uint8Array} bytes
 * @param {object} [options]
 * @param {number} [options.pageCount]  target document page count (for clamping)
 * @returns {Promise<{ topics: object[], annotations: object[], warnings: string[] }>}
 */
export async function parseBcfZip(bytes, options = {}) {
  const pageCount = options.pageCount ?? Infinity;
  const files = await unzip(bytes);

  // Group entries by topic-GUID directory.
  const markupNames = [...files.keys()].filter(n => /(^|\/)markup\.bcf$/i.test(n));
  if (markupNames.length === 0) {
    throw new Error('No markup.bcf found — not a BCF archive');
  }

  const topics = [];
  const annotations = [];
  const warnings = [];

  for (const name of markupNames) {
    const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
    try {
      const xml = textDecoder.decode(files.get(name));

      // Private lossless payload, if this archive is one of ours.
      let opds = null;
      const opdsName = dir ? `${dir}/markup-opds.json` : 'markup-opds.json';
      if (files.has(opdsName)) {
        try { opds = JSON.parse(textDecoder.decode(files.get(opdsName))); }
        catch { warnings.push(`Could not parse ${opdsName}; falling back to markup`); }
      }

      const topic = parseMarkup(xml, opds);
      topic.dir = dir;
      // Note snapshot presence (used by UI to attach an image annotation, etc.).
      const snapName = dir ? `${dir}/snapshot.png` : 'snapshot.png';
      if (files.has(snapName)) topic.snapshot = files.get(snapName);

      topics.push(topic);
      annotations.push(topicToAnnotation(topic, pageCount));
    } catch (e) {
      warnings.push(`Skipped topic "${name}": ${e?.message || e}`);
    }
  }

  if (annotations.length === 0) {
    throw new Error('No readable topics in BCF archive');
  }
  return { topics, annotations, warnings };
}
