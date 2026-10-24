// Test fixtures for capture (photos on markups): small real image bytes.

/** A JPEG prefix (SOI + APP1 Exif) with DateTimeOriginal, in either byte order. */
export function exifJpeg(date = '2026:10:01 09:15:30', { littleEndian = true, ifd0Date = null } = {}) {
  const tiff = [];
  const u16 = (v) => (littleEndian ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (littleEndian ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24]
    : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const ascii = (s) => [...s].map(c => c.charCodeAt(0)).concat([0]);
  // Header (8) + IFD0 with 1 or 2 entries + ExifIFD with 1 entry + strings.
  const ifd0Count = ifd0Date ? 2 : 1;
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + ifd0Count * 12 + 4;
  const str1At = exifAt + 2 + 12 + 4;
  const str2At = str1At + 20;
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0At));
  tiff.push(...u16(ifd0Count));
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt));
  if (ifd0Date) tiff.push(...u16(0x0132), ...u16(2), ...u32(20), ...u32(str2At));
  tiff.push(...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(date ? str1At : 0), ...u32(0));
  tiff.push(...ascii(date || '0000:00:00 00:00:00'));
  if (ifd0Date) tiff.push(...ascii(ifd0Date));
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, 0xff, 0xd9]);
}

/** A real 2×2 RGB PNG (zlib-compressed IDAT, valid CRCs). */
export async function tinyPng() {
  const { deflateSync } = await import('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const be32 = (v) => [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
  const chunk = (type, data) => {
    const td = [...type].map(c => c.charCodeAt(0)).concat([...data]);
    return [...be32(data.length), ...td, ...be32(crc(td))];
  };
  const raw = new Uint8Array([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  const ihdr = [...be32(2), ...be32(2), 8, 2, 0, 0, 0];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', ihdr), ...chunk('IDAT', [...deflateSync(raw)]), ...chunk('IEND', [])]);
}
