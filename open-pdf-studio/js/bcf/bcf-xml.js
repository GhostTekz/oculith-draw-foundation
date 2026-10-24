// Tiny, dependency-free XML helpers for BCF markup.
//
// The parser is a small recursive-descent tokenizer — enough to read the
// well-formed XML that BCF tools emit (elements, attributes, text, CDATA,
// comments, the XML declaration and self-closing tags). It intentionally does
// NOT support namespaces-as-trees, DTDs or processing instructions beyond the
// declaration. It runs identically in Node (no DOMParser) and the WebView, so
// the BCF import path stays unit-testable.

export function escapeXml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeEntities(str) {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/**
 * Parse XML text into a simple node tree.
 * Node shape: { name, attrs: {}, children: [node...], text: string }
 * `text` is the concatenated direct text content of the element.
 * @param {string} xml
 * @returns {object} root element node
 */
export function parseXml(xml) {
  let i = 0;
  const n = xml.length;

  function skipMisc() {
    // Skip whitespace, XML declaration, comments and DOCTYPE at the cursor.
    for (;;) {
      while (i < n && /\s/.test(xml[i])) i++;
      if (xml.startsWith('<?', i)) { i = xml.indexOf('?>', i); i = i < 0 ? n : i + 2; continue; }
      if (xml.startsWith('<!--', i)) { i = xml.indexOf('-->', i); i = i < 0 ? n : i + 3; continue; }
      if (xml.startsWith('<!', i)) { i = xml.indexOf('>', i); i = i < 0 ? n : i + 1; continue; }
      break;
    }
  }

  function parseAttrs(str) {
    const attrs = {};
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(str))) {
      const key = m[1] ?? m[3];
      const val = m[2] ?? m[4];
      attrs[key] = decodeEntities(val);
    }
    return attrs;
  }

  function parseElement() {
    // Assumes xml[i] === '<' and next is a name char.
    i++; // consume '<'
    const start = i;
    while (i < n && !/[\s/>]/.test(xml[i])) i++;
    const name = xml.slice(start, i);
    const attrStart = i;
    // Find end of open tag, respecting quotes.
    let selfClose = false;
    while (i < n) {
      const ch = xml[i];
      if (ch === '"' || ch === "'") {
        const q = ch; i++;
        while (i < n && xml[i] !== q) i++;
        i++; continue;
      }
      if (ch === '>') break;
      i++;
    }
    let attrText = xml.slice(attrStart, i);
    if (attrText.endsWith('/')) { selfClose = true; attrText = attrText.slice(0, -1); }
    i++; // consume '>'

    const node = { name, attrs: parseAttrs(attrText), children: [], text: '' };
    if (selfClose) return node;

    // Parse content until matching close tag.
    for (;;) {
      if (i >= n) break;
      if (xml.startsWith('<![CDATA[', i)) {
        const end = xml.indexOf(']]>', i);
        const raw = xml.slice(i + 9, end < 0 ? n : end);
        node.text += raw;
        i = end < 0 ? n : end + 3;
        continue;
      }
      if (xml.startsWith('<!--', i)) {
        const end = xml.indexOf('-->', i);
        i = end < 0 ? n : end + 3;
        continue;
      }
      if (xml.startsWith('</', i)) {
        i = xml.indexOf('>', i);
        i = i < 0 ? n : i + 1;
        break;
      }
      if (xml[i] === '<') {
        node.children.push(parseElement());
        continue;
      }
      // Text run.
      const next = xml.indexOf('<', i);
      const raw = xml.slice(i, next < 0 ? n : next);
      node.text += decodeEntities(raw);
      i = next < 0 ? n : next;
    }
    return node;
  }

  skipMisc();
  if (i >= n || xml[i] !== '<') throw new Error('Invalid XML: no root element');
  return parseElement();
}

/** First direct child element with the given (local) name. */
export function child(node, name) {
  if (!node) return null;
  return node.children.find(c => localName(c.name) === name) || null;
}

/** All direct child elements with the given (local) name. */
export function children(node, name) {
  if (!node) return [];
  return node.children.filter(c => localName(c.name) === name);
}

/** Trimmed text of the first direct child element with the given name. */
export function childText(node, name) {
  const c = child(node, name);
  return c ? c.text.trim() : '';
}

export function localName(name) {
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}
