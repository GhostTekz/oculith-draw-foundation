// A tool pack is a zip of .btx tool sets (one construction library is dozens
// of sets in one download). Each member is still parsed by btx-import.js, with
// the same size limits. The zip itself is untrusted: paths are basenames
// only, and inflation stops at the per-file limit.

import { MAX_BTX_BYTES } from './btx-import.js';

export const MAX_TOOL_PACK_BYTES = 80 * 1024 * 1024;
export const MAX_TOOL_PACK_SETS = 80;

const MAX_CENTRAL_ENTRIES = 256;

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
  }
  return -1;
}

function baseName(name) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return slash >= 0 ? name.slice(slash + 1) : name;
}

async function inflateRawLimited(data, limit) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This platform cannot open a zipped tool pack.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('A tool set in the pack expands beyond the size limit.');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * .btx members of a zip. Other files (notes, pictures) are ignored.
 * @returns {Promise<{ name: string, bytes: Uint8Array }[]>}
 */
export async function listBtxInZip(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_TOOL_PACK_BYTES) {
    throw new Error('This tool pack is empty or larger than the import limit.');
  }
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error('This file is not a tool pack.');
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('This tool pack uses an unsupported zip extension.');
  if (count > MAX_CENTRAL_ENTRIES || cdOffset + cdSize > bytes.length) {
    throw new Error('This tool pack is not a valid zip.');
  }
  const found = [];
  let cursor = cdOffset;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > bytes.length || u32(bytes, cursor) !== 0x02014b50) {
      throw new Error('This tool pack is not a valid zip.');
    }
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const compSize = u32(bytes, cursor + 20);
    const uncompSize = u32(bytes, cursor + 24);
    const nameLen = u16(bytes, cursor + 28);
    const extraLen = u16(bytes, cursor + 30);
    const commentLen = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLen);
    cursor += 46 + nameLen + extraLen + commentLen;
    let name = '';
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); }
    catch { continue; }
    if (!name || name.endsWith('/') || name.includes('..') || name.includes('\0') || name.startsWith('__MACOSX/')) continue;
    const base = baseName(name);
    if (!base || base.startsWith('.') || !/\.btx$/iu.test(base)) continue;
    if (flags & 0x1) throw new Error(`${base} is encrypted and cannot be imported.`);
    if (method !== 0 && method !== 8) throw new Error(`${base} is stored in an unsupported way.`);
    if (uncompSize > MAX_BTX_BYTES || compSize > MAX_BTX_BYTES) {
      throw new Error(`${base} is larger than a tool set file.`);
    }
    if (localOffset + 30 > bytes.length) throw new Error('This tool pack is incomplete.');
    const dataStart = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
    if (dataStart + compSize > bytes.length) throw new Error('This tool pack is incomplete.');
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    const raw = method === 0 ? compressed : await inflateRawLimited(compressed, MAX_BTX_BYTES);
    if (raw.byteLength > MAX_BTX_BYTES) throw new Error(`${base} is larger than a tool set file.`);
    found.push({ name: base, bytes: raw });
    if (found.length > MAX_TOOL_PACK_SETS) throw new Error('The tool pack has too many tool sets.');
  }
  return found;
}
