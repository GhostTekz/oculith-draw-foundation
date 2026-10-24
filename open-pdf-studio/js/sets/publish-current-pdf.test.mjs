import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildCurrentSetPdf } from './publish-current-pdf.js';

function manifest(bytes, fingerprint = createHash('sha256').update(bytes).digest('hex')) {
  return { version: 1, name: 'Site set', sheets: [{ id: 'a101', label: 'A-101', title: '',
    revision: 'B', filePath: 'current.pdf', page: 1, sourceSha256: fingerprint,
    history: [{ filePath: 'old.pdf', page: 1, revision: 'A', replacedAt: '2026-10-13T00:00:00Z' }],
    sourceAliases: [] }] };
}

test('a signed current source fails closed before a combined PDF is returned', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const signedField = pdf.context.obj({ FT: 'Sig', T: 'Approval', V: { Type: 'Sig', ByteRange: [0, 1, 2, 3] } });
  pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [signedField] }));
  const bytes = new Uint8Array(await pdf.save());
  await assert.rejects(buildCurrentSetPdf(manifest(bytes), async () => bytes),
    /signed or certified PDFs cannot be combined/u);
});

test('interactive form fields cannot be silently dropped while page widgets are copied', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const field = pdf.context.obj({ FT: 'Tx', T: 'Review status', V: 'Approved' });
  pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [field] }));
  const bytes = new Uint8Array(await pdf.save());
  await assert.rejects(buildCurrentSetPdf(manifest(bytes), async () => bytes),
    /interactive form fields cannot be combined/u);
});

test('a legacy sheet without a current fingerprint cannot publish a historical source by accident', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = new Uint8Array(await pdf.save());
  let reads = 0;
  const set = manifest(bytes);
  delete set.sheets[0].sourceSha256;
  await assert.rejects(buildCurrentSetPdf(set, async () => { reads++; return bytes; }),
    /no recorded fingerprint/u);
  assert.equal(reads, 0);
});
