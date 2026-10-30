import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { fingerprintPdfBytes } from './pdf-fingerprint.js';
import { buildSetPageGeometryAudit } from './set-page-geometry.js';

async function drawing() {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([612, 792]);
  first.setCropBox(36, 72, 540, 648);
  first.setRotation(degrees(90));
  pdf.addPage([1224, 792]);
  return new Uint8Array(await pdf.save());
}

test('page geometry audit reads each PDF once, exposes only verified pages, and changes no sources', async () => {
  const bytes = await drawing();
  const sha = await fingerprintPdfBytes(bytes);
  const changed = 'a'.repeat(64);
  const register = { sheets: [
    { id: 'one', label: 'A-101', filePath: 'set.pdf', page: 1, sourceSha256: sha },
    { id: 'two', label: 'A-102', filePath: 'set.pdf', page: 2, sourceSha256: sha },
    { id: 'changed', label: 'A-103', filePath: 'set.pdf', page: 1, sourceSha256: changed },
    { id: 'unverified', label: 'A-104', filePath: 'set.pdf', page: 1 },
    { id: 'missing-page', label: 'A-105', filePath: 'set.pdf', page: 3, sourceSha256: sha },
    { id: 'missing', label: 'A-106', filePath: 'missing.pdf', page: 1, sourceSha256: sha },
  ] };
  const original = JSON.stringify(register);
  const reads = [];
  const audit = await buildSetPageGeometryAudit(register, path => {
    reads.push(path);
    return path === 'set.pdf' ? bytes : null;
  });
  assert.deepEqual(reads, ['set.pdf', 'missing.pdf']);
  assert.equal(audit.register, register);
  assert.deepEqual(audit.rows.map(row => row.status),
    ['verified', 'verified', 'changed', 'unverified', 'missing-page', 'missing']);
  const first = audit.rows[0].geometry;
  assert.equal(first.rotation, 90);
  assert.deepEqual([first.widthInches, first.heightInches], [9, 7.5]);
  assert.deepEqual(first.boxes.media, { x: 0, y: 0, width: 612, height: 792 });
  assert.deepEqual(first.boxes.crop, { x: 36, y: 72, width: 540, height: 648 });
  assert.ok(first.differingBoxes.includes('Crop'));
  assert.deepEqual([audit.rows[1].geometry.widthInches, audit.rows[1].geometry.heightInches], [17, 11]);
  assert.ok(audit.rows.slice(2).every(row => !row.geometry));
  assert.equal(await fingerprintPdfBytes(bytes), sha);
  assert.equal(JSON.stringify(register), original);
});

test('page geometry audit reports unreadable verified source without exposing geometry', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha = await fingerprintPdfBytes(bytes);
  const register = { sheets: [{ id: 'one', label: 'A-101', filePath: 'bad.pdf', page: 1, sourceSha256: sha }] };
  const audit = await buildSetPageGeometryAudit(register, () => bytes);
  assert.equal(audit.rows[0].status, 'unreadable');
  assert.equal(audit.rows[0].geometry, undefined);
});

test('displayed dimensions honor PDF UserUnit while page boxes retain native coordinates', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  const bytes = new Uint8Array(await pdf.save());
  const sha = await fingerprintPdfBytes(bytes);
  const register = { sheets: [{ id: 'one', label: 'A-101', filePath: 'large.pdf',
    page: 1, sourceSha256: sha }] };
  const audit = await buildSetPageGeometryAudit(register, () => bytes);
  assert.equal(audit.rows[0].status, 'verified');
  assert.deepEqual([audit.rows[0].geometry.widthInches, audit.rows[0].geometry.heightInches], [17, 22]);
  assert.deepEqual([audit.rows[0].geometry.boxes.media.width, audit.rows[0].geometry.boxes.media.height], [612, 792]);
});
