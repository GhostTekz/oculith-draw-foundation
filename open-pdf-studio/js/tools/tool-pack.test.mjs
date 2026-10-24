import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { listBtxInZip } from './tool-pack.js';
import { parseBtx } from './btx-import.js';

const encode = (text) => new TextEncoder().encode(text);
const btx = (title) => encode(`<?xml version="1.0"?><BluebeamRevuToolSet Version="1"><Title>${title}</Title></BluebeamRevuToolSet>`);

function zip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const stored = file.method !== 8;
    const data = stored ? file.data : deflateRawSync(file.data);
    const local = new Uint8Array(30 + name.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, stored ? 0 : 8, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const header = new DataView(central.buffer);
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(10, stored ? 0 : 8, true);
    header.setUint32(20, data.length, true);
    header.setUint32(24, file.data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true);
  tail.setUint16(8, files.length, true);
  tail.setUint16(10, files.length, true);
  tail.setUint32(12, directorySize, true);
  tail.setUint32(16, offset, true);
  const out = new Uint8Array(offset + directorySize + 22);
  let cursor = 0;
  for (const part of [...locals, ...centrals]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(end, cursor);
  return out;
}

test('a tool pack keeps each .btx and ignores notes and unsafe paths', async () => {
  const packed = zip([
    { name: 'notes/readme.pdf', data: encode('%PDF-1.4') },
    { name: 'Electrical/doors.btx', data: btx('Doors'), method: 8 },
    { name: 'site.btx', data: btx('Site') },
    { name: '../escape.btx', data: btx('No') },
    { name: '__MACOSX/site.btx', data: btx('Junk') },
  ]);
  const entries = await listBtxInZip(packed);
  assert.deepEqual(entries.map(entry => entry.name), ['doors.btx', 'site.btx']);
  const doors = await parseBtx(entries[0].bytes);
  assert.equal(doors.name, 'Doors');
  assert.equal(doors.tools.length, 0);
});
