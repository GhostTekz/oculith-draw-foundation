import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readExifDate, exifDateToIso, fitWithinEdge, sniffImageType, safeFileName, captureMaxEdge, attachmentMaxBytes,
  bytesToBase64, base64ToBytes, dataUrlToBytes, bytesToDataUrl, makePhoto, attachmentNames, attachmentCount,
  isOpenableAttachment, makeAttachedFile, photoDateText, withAddedPhotos, CAPTURE_MAX_PHOTOS,
} from './capture.js';
import { exifJpeg } from './capture.testhulp.mjs';

test('EXIF DateTimeOriginal is read in both byte orders', () => {
  assert.equal(readExifDate(exifJpeg()), '2026-10-01T09:15:30');
  assert.equal(readExifDate(exifJpeg('2025:01:31 23:59:01', { littleEndian: false })), '2025-01-31T23:59:01');
  assert.equal(readExifDate(exifJpeg(null, { ifd0Date: '2024:02:03 04:05:06' })), '2024-02-03T04:05:06',
    'falls back to IFD0 DateTime');
});

test('EXIF reader is safe on garbage and truncated files', () => {
  assert.equal(readExifDate(new Uint8Array([0xff, 0xd8])), null);
  assert.equal(readExifDate(new Uint8Array([1, 2, 3])), null);
  const full = exifJpeg();
  for (let cut = 4; cut < full.length - 2; cut += 3) assert.doesNotThrow(() => readExifDate(full.slice(0, cut)));
  const evil = exifJpeg();
  evil[20] = 0xff; evil[21] = 0xff; // IFD offset far outside the segment
  assert.doesNotThrow(() => readExifDate(evil));
  assert.equal(exifDateToIso('0000:00:00 00:00:00'), null);
  assert.equal(exifDateToIso('2026:13:01 00:00:00'), null);
});

test('photo size fits the configured longest edge and never enlarges', () => {
  assert.deepEqual(fitWithinEdge(4032, 3024, 2048), { width: 2048, height: 1536, scaled: true });
  assert.deepEqual(fitWithinEdge(3024, 4032, 2048), { width: 1536, height: 2048, scaled: true });
  assert.deepEqual(fitWithinEdge(800, 600, 2048), { width: 800, height: 600, scaled: false });
  assert.equal(captureMaxEdge({}), 2048);
  assert.equal(captureMaxEdge({ captureMaxEdge: 1024 }), 1024);
  assert.equal(captureMaxEdge({ captureMaxEdge: 10 }), 256);
  assert.equal(captureMaxEdge({ captureMaxEdge: 99999 }), 8192);
  assert.equal(attachmentMaxBytes({}), 25 * 1024 * 1024);
  assert.equal(attachmentMaxBytes({ attachmentMaxMb: 1 }), 1024 * 1024);
});

test('image kind comes from the bytes; HEIC is recognised for the reject message', () => {
  assert.equal(sniffImageType(exifJpeg()), 'jpeg');
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  assert.equal(sniffImageType(heic), 'heic');
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3]), 'IMG_0001.HEIC'), 'heic');
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3]), 'notes.txt'), null);
});

test('file names from a PDF cannot escape a folder', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Users\\x\\photo 1.jpg'), 'photo 1.jpg');
  assert.equal(safeFileName('..'), 'attachment');
  assert.equal(safeFileName('a<b>:c?.pdf'), 'a_b__c_.pdf');
  assert.equal(safeFileName('x'.repeat(300) + '.pdf').length, 120);
  assert.ok(safeFileName('x'.repeat(300) + '.pdf').endsWith('.pdf'));
  assert.equal(isOpenableAttachment('spec.pdf'), true);
  assert.equal(isOpenableAttachment('setup.exe'), false);
  assert.equal(isOpenableAttachment('run.sh'), false);
});

test('base64 and data URLs round-trip any bytes', () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7919) & 255);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.equal(bytesToBase64(new Uint8Array([1])), Buffer.from([1]).toString('base64'));
  assert.equal(bytesToBase64(new Uint8Array([1, 2])), Buffer.from([1, 2]).toString('base64'));
  assert.deepEqual(dataUrlToBytes(bytesToDataUrl(bytes.slice(0, 5), 'image/jpeg')), bytes.slice(0, 5));
  assert.equal(dataUrlToBytes('data:text/plain,hello'), null);
});

test('photo entries, names and counts', () => {
  const p = makePhoto(exifJpeg(), { name: 'IMG_1.png', mimeType: 'image/jpeg', width: 10, height: 8, date: '2026-10-01T09:15:30' });
  assert.equal(p.name, 'IMG_1.jpg', 'the stored type decides the extension');
  assert.equal(p.mimeType, 'image/jpeg');
  const file = makeAttachedFile(new Uint8Array([1, 2, 3]), 'spec sheet.pdf');
  assert.equal(file.mimeType, 'application/pdf');
  const ann = { capturePhotos: [p, { bogus: true }], attachedFile: file };
  assert.deepEqual(attachmentNames(ann), ['IMG_1.jpg', 'spec sheet.pdf']);
  assert.equal(attachmentCount(ann), 2);
  assert.equal(attachmentCount({}), 0);
  assert.equal(photoDateText('2026-10-01T09:15:30'), '2026-10-01 09:15');
  const many = Array.from({ length: CAPTURE_MAX_PHOTOS + 5 }, () => p);
  assert.equal(withAddedPhotos({ capturePhotos: [] }, many).length, CAPTURE_MAX_PHOTOS);
});
