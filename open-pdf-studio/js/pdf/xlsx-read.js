// Read an .xlsx back into plain cells: sheet names, values, formulas and
// style indexes, plus a strict XML well-formedness check for every part.
// Used to verify written workbooks (tests, export checks); it reads the
// subset of SpreadsheetML the app writes and what office suites save.
import { unzip } from '../bcf/bcf-zip.js';

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    if (!(e in ENTITY)) throw new Error(`Unknown XML entity ${m}`);
    return ENTITY[e];
  });
}

/**
 * Throw when `text` is not well-formed XML: one root, balanced and properly
 * nested tags, quoted unique attributes, known entities, no stray `<` or `&`.
 */
export function assertWellFormedXml(text, label = 'XML') {
  const src = String(text);
  const stack = [];
  let roots = 0;
  let i = 0;
  const fail = (why) => { throw new Error(`${label}: ${why} at offset ${i}`); };
  const checkText = (t) => {
    if (/&(?!(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(t)) fail('bare &');
    if (t.includes('>') && /]]>/.test(t)) fail('"]]>" in text');
    if (!stack.length && t.trim()) fail('text outside the root element');
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { checkText(src.slice(i)); break; }
    checkText(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<?', i)) { const end = src.indexOf('?>', i); if (end < 0) fail('unclosed declaration'); i = end + 2; continue; }
    if (src.startsWith('<!--', i)) { const end = src.indexOf('-->', i); if (end < 0) fail('unclosed comment'); i = end + 3; continue; }
    if (src.startsWith('<![CDATA[', i)) { const end = src.indexOf(']]>', i); if (end < 0) fail('unclosed CDATA'); i = end + 3; continue; }
    if (src.startsWith('<!', i)) fail('DOCTYPE not allowed');
    const m = /^<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(src.slice(i, i + 65536));
    if (!m) fail('malformed tag');
    const [whole, close, name, attrs, selfClose] = m;
    if (close) {
      if (attrs.trim() || selfClose) fail(`malformed end tag </${name}>`);
      if (stack.pop() !== name) fail(`mismatched </${name}>`);
    } else {
      const names = [...attrs.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/g)];
      const seen = new Set();
      for (const [, attr, value] of names) {
        if (seen.has(attr)) fail(`duplicate attribute ${attr}`);
        seen.add(attr);
        if (/&(?!(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(value)) fail(`bare & in ${attr}`);
      }
      if (!stack.length) { roots += 1; if (roots > 1) fail('more than one root element'); }
      if (!selfClose) stack.push(name);
    }
    i += whole.length;
  }
  if (stack.length) throw new Error(`${label}: unclosed <${stack.at(-1)}>`);
  if (roots !== 1) throw new Error(`${label}: no root element`);
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};
const textOf = (fragment) => [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decodeXml(m[1] || '')).join('');

function resolveTarget(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function relsOf(files, part) {
  const dir = part.split('/').slice(0, -1).join('/');
  const name = `${dir ? `${dir}/` : ''}_rels/${part.split('/').at(-1)}.rels`;
  const data = files.get(name);
  const out = new Map();
  if (!data) return out;
  for (const m of new TextDecoder().decode(data).matchAll(/<Relationship\b[^>]*>/g)) {
    out.set(attr(m[0], 'Id'), { type: attr(m[0], 'Type'), target: resolveTarget(part, attr(m[0], 'Target')) });
  }
  return out;
}

/**
 * The workbook's sheets as `{ name, cells: Map<'A1', { v, f, s, t }>, tables }`,
 * its defined names and every part's text. Every XML part is checked for
 * well-formedness first.
 */
export async function readXlsx(bytes) {
  const files = await unzip(bytes);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = new Map();
  for (const [name, data] of files) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const text = decoder.decode(data);
    assertWellFormedXml(text, name);
    parts.set(name, text);
  }
  const types = parts.get('[Content_Types].xml');
  if (!types) throw new Error('Missing [Content_Types].xml');
  const rootRels = relsOf(files, '');
  const bookPart = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target;
  if (!bookPart || !parts.has(bookPart)) throw new Error('Missing workbook part');
  for (const name of parts.keys()) {
    if (name.endsWith('.rels') || name === '[Content_Types].xml') continue;
    const ext = name.split('.').pop();
    if (!types.includes(`PartName="/${name}"`) && !types.includes(`Extension="${ext}"`)) throw new Error(`No content type for ${name}`);
  }
  const book = parts.get(bookPart);
  const bookRels = relsOf(files, bookPart);
  const sstPart = [...bookRels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target;
  const strings = sstPart && parts.has(sstPart)
    ? [...parts.get(sstPart).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''))) : [];
  const names = new Map([...book.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)]
    .map((m) => [attr(`<x${m[1]}>`, 'name'), decodeXml(m[2])]));
  const sheets = [];
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const target = bookRels.get(attr(m[0], 'r:id'))?.target;
    const xmlText = parts.get(target);
    if (!xmlText) throw new Error(`Missing sheet part for ${name}`);
    const cells = new Map();
    for (const c of xmlText.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = `<c${c[1]}>`;
      const ref = attr(head, 'r');
      const t = attr(head, 't') || 'n';
      const body = c[2] || '';
      const f = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body);
      const rawV = /<v>([\s\S]*?)<\/v>/.exec(body);
      let v = null;
      if (t === 's' && rawV) v = strings[Number(rawV[1])] ?? null;
      else if (t === 'inlineStr') v = textOf(body);
      else if (t === 'b' && rawV) v = rawV[1] === '1';
      else if ((t === 'str' || t === 'e') && rawV) v = decodeXml(rawV[1]);
      else if (rawV) v = Number(rawV[1]);
      cells.set(ref, { v, f: f ? decodeXml(f[1]) : null, s: Number(attr(head, 's') || 0), t });
    }
    const tables = [];
    const sheetRels = relsOf(files, target);
    for (const tp of xmlText.matchAll(/<tablePart\b[^>]*>/g)) {
      const tablePart = sheetRels.get(attr(tp[0], 'r:id'))?.target;
      const tx = parts.get(tablePart);
      if (!tx) throw new Error(`Missing table part on ${name}`);
      const head = /<table\b[^>]*>/.exec(tx)[0];
      tables.push({ name: attr(head, 'name'), ref: attr(head, 'ref'),
        columns: [...tx.matchAll(/<tableColumn\b[^>]*>/g)].map((col) => attr(col[0], 'name')) });
    }
    const pane = /<pane\b[^>]*>/.exec(xmlText)?.[0];
    sheets.push({ name, cells, tables, xml: xmlText,
      freeze: pane && attr(pane, 'state') === 'frozen' ? { rows: Number(attr(pane, 'ySplit') || 0), cols: Number(attr(pane, 'xSplit') || 0) } : null });
  }
  return { sheets, names, parts };
}
