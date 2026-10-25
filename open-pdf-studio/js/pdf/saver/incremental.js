// Incremental save: append the objects a save changed to the end of the
// original bytes, with a new cross-reference section whose /Prev points at
// the previous one (PDF 32000-1, 7.5.6). Everything before the append stays
// byte for byte as it was.
//
// The saver builds the document in pdf-lib as always. Right after loading it
// takes a snapshot of every indirect object (identity plus a hash of its
// serialization; a stream by its dictionary and its contents array), and
// before writing it asks buildIncrement() for the objects that differ. Any
// doubt returns { reason } and the saver writes the whole file as before.

import {
  PDFContext, PDFObjectParser, PDFRawStream, PDFDict, PDFRef, PDFName, PDFArray,
  PDFNumber, PDFHexString, decodePDFRawStream,
} from 'pdf-lib';

const N = (s) => PDFName.of(s);
const latin1 = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

/** Revisions after which a save writes the whole file again. */
export const MAX_REVISIONS = 64;
/** Appended bytes (all increments together) that trigger a full rewrite. */
export function compactionDue(totalLength, base) {
  const appended = totalLength - base;
  return appended > 512 * 1024 && appended > base * 0.5;
}

const isWs = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
const isDigit = (b) => b >= 0x30 && b <= 0x39;

function skipWs(bytes, pos) {
  while (pos < bytes.length) {
    const b = bytes[pos];
    if (isWs(b)) { pos++; continue; }
    if (b === 0x25) { // comment
      while (pos < bytes.length && bytes[pos] !== 0x0a && bytes[pos] !== 0x0d) pos++;
      continue;
    }
    break;
  }
  return pos;
}

function matches(bytes, pos, word) {
  if (pos + word.length > bytes.length) return false;
  for (let i = 0; i < word.length; i++) if (bytes[pos + i] !== word.charCodeAt(i)) return false;
  return true;
}

function readInt(bytes, pos) {
  let end = pos;
  while (end < bytes.length && isDigit(bytes[end])) end++;
  if (end === pos || end - pos > 15) return null;
  let v = 0;
  for (let i = pos; i < end; i++) v = v * 10 + (bytes[i] - 0x30);
  return { value: v, end };
}

function lastIndexOf(bytes, word, from, stop = 0) {
  for (let i = Math.min(from, bytes.length - word.length); i >= stop; i--) {
    if (matches(bytes, i, word)) return i;
  }
  return -1;
}

const numberOf = (obj) => (obj instanceof PDFNumber ? obj.asNumber() : null);

/** A classic table at pos: its entries are well formed; returns the trailer. */
function readTable(bytes, pos, ctx) {
  pos = skipWs(bytes, pos + 4);
  for (let guard = 0; guard < 1e6; guard++) {
    if (matches(bytes, pos, 'trailer')) {
      const dict = PDFObjectParser.forBytes(bytes.subarray(skipWs(bytes, pos + 7)), ctx).parseObject();
      return dict instanceof PDFDict ? dict : null;
    }
    const start = readInt(bytes, pos);
    if (!start) return null;
    const count = readInt(bytes, skipWs(bytes, start.end));
    if (!count) return null;
    pos = skipWs(bytes, count.end);
    for (let i = 0; i < count.value; i++) {
      const off = readInt(bytes, pos);
      if (!off) return null;
      const gen = readInt(bytes, skipWs(bytes, off.end));
      if (!gen) return null;
      const kind = bytes[skipWs(bytes, gen.end)];
      if (kind !== 0x6e && kind !== 0x66) return null; // n / f
      pos = skipWs(bytes, skipWs(bytes, gen.end) + 1);
    }
  }
  return null;
}

/** An xref stream at pos: decodes and checks its size; returns its dict. */
function readXrefStream(bytes, pos, ctx) {
  const num = readInt(bytes, pos);
  if (!num) return null;
  const gen = readInt(bytes, skipWs(bytes, num.end));
  if (!gen) return null;
  const objPos = skipWs(bytes, gen.end);
  if (!matches(bytes, objPos, 'obj')) return null;
  const stream = PDFObjectParser.forBytes(bytes.subarray(objPos + 3), ctx).parseObject();
  if (!(stream instanceof PDFRawStream) || stream.dict.get(N('Type')) !== N('XRef')) return null;
  const w = stream.dict.get(N('W'));
  if (!(w instanceof PDFArray) || w.size() !== 3) return null;
  const widths = w.asArray().map(numberOf);
  if (widths.some((x) => x === null || x < 0 || x > 8)) return null;
  const size = numberOf(stream.dict.get(N('Size')));
  if (size === null) return null;
  const index = stream.dict.get(N('Index'));
  let entries = 0;
  if (index instanceof PDFArray) {
    const ns = index.asArray().map(numberOf);
    if (ns.length % 2 || ns.some((x) => x === null)) return null;
    for (let i = 1; i < ns.length; i += 2) entries += ns[i];
  } else {
    entries = size;
  }
  const data = decodePDFRawStream(stream).decode();
  if (data.length < entries * (widths[0] + widths[1] + widths[2])) return null;
  return stream.dict;
}

/**
 * Can these bytes take an incremental update? Walks the cross-reference
 * chain from the last startxref.
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, startxref: number, kind: 'table'|'stream', trailer: PDFDict,
 *   size: number, revisions: number, base: number } | { ok: false, reason: string }}
 */
export function inspectSource(bytes) {
  try {
    if (!(bytes instanceof Uint8Array) || !matches(bytes, 0, '%PDF-')) return { ok: false, reason: 'header' };
    const tail = Math.max(0, bytes.length - 4096);
    const at = lastIndexOf(bytes, 'startxref', bytes.length - 1, tail);
    if (at < 0) return { ok: false, reason: 'no-startxref' };
    const sx = readInt(bytes, skipWs(bytes, at + 9));
    if (!sx || sx.value <= 0 || sx.value >= at) return { ok: false, reason: 'bad-startxref' };
    if (lastIndexOf(bytes, '%%EOF', bytes.length - 1, at) < at) return { ok: false, reason: 'no-eof' };
    const ctx = PDFContext.create();
    const seen = new Set();
    let offset = sx.value;
    let kind = null;
    let latest = null;
    let size = 0;
    let revisions = 0;
    while (offset !== null) {
      if (seen.has(offset) || offset <= 0 || offset >= bytes.length || seen.size > 4096) {
        return { ok: false, reason: 'bad-prev' };
      }
      seen.add(offset);
      const pos = skipWs(bytes, offset);
      const isTable = matches(bytes, pos, 'xref');
      const trailer = isTable ? readTable(bytes, pos, ctx) : readXrefStream(bytes, pos, ctx);
      if (!trailer) return { ok: false, reason: 'bad-xref' };
      if (!latest) { latest = trailer; kind = isTable ? 'table' : 'stream'; }
      if (trailer.get(N('Encrypt')) !== undefined) return { ok: false, reason: 'encrypted' };
      const s = numberOf(trailer.get(N('Size')));
      if (s === null) return { ok: false, reason: 'no-size' };
      size = Math.max(size, s);
      revisions++;
      const prev = trailer.get(N('Prev'));
      offset = prev === undefined ? null : numberOf(prev);
      if (prev !== undefined && offset === null) return { ok: false, reason: 'bad-prev' };
    }
    if (!(latest.get(N('Root')) instanceof PDFRef)) return { ok: false, reason: 'no-root' };
    const base = numberOf(latest.get(N('OPS_IncrementalBase')));
    return {
      ok: true, startxref: sx.value, kind, trailer: latest, size, revisions,
      base: base !== null && base > 0 && base <= bytes.length ? base : bytes.length,
    };
  } catch (error) {
    return { ok: false, reason: `xref: ${error?.message || error}` };
  }
}

// ── Object snapshot ─────────────────────────────────────────────────────

let scratch = new Uint8Array(1 << 16);
function hashOf(obj) {
  const target = obj instanceof PDFRawStream ? obj.dict : obj;
  const n = target.sizeInBytes();
  if (n > scratch.length) scratch = new Uint8Array(Math.max(n, scratch.length * 2));
  target.copyBytesInto(scratch, 0);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    const c = scratch[i];
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x7feb352d);
    b ^= b >>> 15;
  }
  return `${n}.${a >>> 0}.${b >>> 0}`;
}

/**
 * Remember every indirect object as loaded. Call straight after
 * PDFDocument.load(), before anything changes the document.
 */
export function snapshotObjects(pdfDoc) {
  const objects = new Map();
  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    objects.set(ref.objectNumber, {
      gen: ref.generationNumber,
      obj,
      contents: obj instanceof PDFRawStream ? obj.contents : null,
      hash: hashOf(obj),
    });
  }
  const pages = pdfDoc.getPages().map((p) => p.ref);
  return { objects, pages, pagesRef: pdfDoc.catalog.get(N('Pages')) };
}

/** Make pdf-lib number new objects past every number the file uses. */
export function reserveObjectNumbers(context, size) {
  if (size - 1 > context.largestObjectNumber) context.largestObjectNumber = size - 1;
}

function changedObjects(pdfDoc, snap, source) {
  const out = [];
  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    const s = snap.objects.get(ref.objectNumber);
    if (!s) {
      if (ref.objectNumber < source.size) return { reason: 'number-in-use' };
      out.push([ref, obj]);
    } else if (s.gen !== ref.generationNumber || s.obj !== obj
      || (obj instanceof PDFRawStream && obj.contents !== s.contents) || hashOf(obj) !== s.hash) {
      out.push([ref, obj]);
    }
  }
  return { objects: out };
}

function randomHex(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function runsOf(numbers) {
  const runs = [];
  for (const n of numbers) {
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1] === n) last[1]++;
    else runs.push([n, 1]);
  }
  return runs;
}

/**
 * The bytes to append, or why the whole file must be written instead.
 * Mirrors the steps of PDFDocument.save() before serializing (default page,
 * form appearances, flush), which the caller runs first via prepareForWrite().
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {Uint8Array} bytes  the original file
 * @param {ReturnType<typeof inspectSource>} source
 * @param {ReturnType<typeof snapshotObjects>} snap
 * @returns {{ bytes: Uint8Array, objects: number } | { reason: string }}
 */
export function buildIncrement(pdfDoc, bytes, source, snap) {
  const context = pdfDoc.context;
  if (context.trailerInfo.Encrypt) return { reason: 'encrypted' };
  const root = context.trailerInfo.Root;
  if (!(root instanceof PDFRef) || root !== source.trailer.get(N('Root'))) return { reason: 'root' };
  // Page structure: same pages in the same order, page tree untouched.
  const pages = pdfDoc.getPages().map((p) => p.ref);
  if (pages.length !== snap.pages.length || pages.some((r, i) => r !== snap.pages[i])) return { reason: 'pages' };
  if (pdfDoc.catalog.get(N('Pages')) !== snap.pagesRef) return { reason: 'pages' };
  const found = changedObjects(pdfDoc, snap, source);
  if (found.reason) return found;
  const objects = found.objects;
  for (const [, obj] of objects) {
    if (obj instanceof PDFDict && obj.get(N('Type')) === N('Pages')) return { reason: 'pages' };
  }
  // pdf-lib updates the info dictionary on load (ModDate, Producer): write it.
  const info = context.trailerInfo.Info;
  if (info instanceof PDFRef && !objects.some(([r]) => r === info)) {
    const obj = context.lookup(info);
    if (obj) objects.push([info, obj]);
  }
  objects.sort((x, y) => x[0].objectNumber - y[0].objectNumber);

  // Objects
  const lead = bytes[bytes.length - 1] === 0x0a || bytes[bytes.length - 1] === 0x0d ? 0 : 1;
  const heads = objects.map(([ref]) => latin1(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
  const tailWord = latin1('\nendobj\n');
  let size = lead;
  const sizes = objects.map(([, obj], i) => {
    const n = obj.sizeInBytes();
    size += heads[i].length + n + tailWord.length;
    return n;
  });
  const body = new Uint8Array(size);
  let pos = 0;
  if (lead) body[pos++] = 0x0a;
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(bytes.length + pos);
    body.set(heads[i], pos); pos += heads[i].length;
    const written = objects[i][1].copyBytesInto(body, pos);
    if (written !== sizes[i]) return { reason: 'serialize' };
    pos += written;
    body.set(tailWord, pos); pos += tailWord.length;
  }
  const xrefOffset = bytes.length + pos;

  // Trailer entries
  const trailer = new Map();
  trailer.set('Root', root);
  if (info) trailer.set('Info', info);
  const oldId = source.trailer.get(N('ID'));
  if (oldId instanceof PDFArray && oldId.size() === 2) {
    trailer.set('ID', context.obj([oldId.get(0), PDFHexString.of(randomHex(16))]));
  }
  trailer.set('Prev', PDFNumber.of(source.startxref));
  trailer.set('OPS_IncrementalBase', PDFNumber.of(source.base));
  const largest = Math.max(source.size - 1, context.largestObjectNumber,
    objects.length ? objects[objects.length - 1][0].objectNumber : 0);

  let section;
  if (source.kind === 'table') {
    const runs = runsOf(objects.map(([r]) => r.objectNumber));
    let text = 'xref\n';
    let k = 0;
    for (const [start, count] of runs) {
      text += `${start} ${count}\n`;
      for (let i = 0; i < count; i++, k++) {
        const gen = objects[k][0].generationNumber;
        text += `${String(offsets[k]).padStart(10, '0')} ${String(gen).padStart(5, '0')} n\r\n`;
      }
    }
    const dict = context.obj({});
    dict.set(N('Size'), PDFNumber.of(largest + 1));
    for (const [k2, v] of trailer) dict.set(N(k2), v);
    section = latin1(`${text}trailer\n${dict.toString()}\nstartxref\n${xrefOffset}\n%%EOF\n`);
  } else {
    // An uncompressed cross-reference stream, itself the last new object.
    const own = largest + 1;
    const entries = objects.map(([ref], i) => [ref.objectNumber, offsets[i], ref.generationNumber]);
    entries.push([own, xrefOffset, 0]);
    const ow = xrefOffset > 0xffffffff ? 8 : 4;
    const rowSize = 1 + ow + 2;
    const data = new Uint8Array(entries.length * rowSize);
    entries.forEach(([, off, gen], i) => {
      let p = i * rowSize;
      data[p++] = 1;
      for (let j = 0; j < ow; j++) data[p + j] = Math.floor(off / 2 ** (8 * (ow - 1 - j))) & 0xff;
      p += ow;
      data[p++] = (gen >> 8) & 0xff;
      data[p] = gen & 0xff;
    });
    const index = runsOf(entries.map((e) => e[0])).flat();
    const dict = context.obj({});
    dict.set(N('Type'), N('XRef'));
    dict.set(N('Size'), PDFNumber.of(own + 1));
    dict.set(N('W'), context.obj([1, ow, 2]));
    dict.set(N('Index'), context.obj(index));
    for (const [k2, v] of trailer) dict.set(N(k2), v);
    const stream = PDFRawStream.of(dict, data);
    const head = latin1(`${own} 0 obj\n`);
    const objBytes = new Uint8Array(stream.sizeInBytes());
    stream.copyBytesInto(objBytes, 0);
    const end = latin1(`\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`);
    section = new Uint8Array(head.length + objBytes.length + end.length);
    section.set(head, 0);
    section.set(objBytes, head.length);
    section.set(end, head.length + objBytes.length);
  }
  const out = new Uint8Array(body.length + section.length);
  out.set(body, 0);
  out.set(section, body.length);
  return { bytes: out, objects: objects.length };
}

/** The steps PDFDocument.save() takes before it serializes. */
export async function prepareForWrite(pdfDoc) {
  if (pdfDoc.getPageCount() === 0) return false;
  const form = pdfDoc.formCache?.getValue?.();
  if (form) form.updateFieldAppearances();
  await pdfDoc.flush();
  return true;
}

/** The original bytes with the increment appended. */
export function appendBytes(original, increment) {
  const out = new Uint8Array(original.length + increment.length);
  out.set(original, 0);
  out.set(increment, original.length);
  return out;
}
