import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
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

test('current set export gives sorted sheets matching PDF page labels and bookmarks', async () => {
  const architectural = await PDFDocument.create();
  architectural.addPage([501, 701]);
  architectural.addPage([502, 702]);
  const mechanical = await PDFDocument.create();
  mechanical.addPage([601, 801]);
  const sources = new Map([
    ['architecture.pdf', new Uint8Array(await architectural.save())],
    ['mechanical.pdf', new Uint8Array(await mechanical.save())],
  ]);
  const hash = path => createHash('sha256').update(sources.get(path)).digest('hex');
  const initialHashes = new Map([...sources.keys()].map(path => [path, hash(path)]));
  const register = { version: 1, name: 'Site set', sheets: [
    { id: '__proto__', label: 'M-201', title: 'Ventilation', revision: 'B', filePath: 'mechanical.pdf',
      page: 1, sourceSha256: hash('mechanical.pdf'), history: [], sourceAliases: [] },
    { id: 'a102', label: 'A-102', title: 'Upper floor', revision: 'C', filePath: 'architecture.pdf',
      page: 2, sourceSha256: hash('architecture.pdf'), history: [], sourceAliases: [] },
    { id: 'a101', label: 'A-101', title: '', revision: 'A', filePath: 'architecture.pdf',
      page: 1, sourceSha256: hash('architecture.pdf'), history: [], sourceAliases: [] },
  ] };
  const reads = [];
  const published = await buildCurrentSetPdf(register, async path => {
    reads.push(path);
    return sources.get(path);
  });
  assert.deepEqual(reads, ['architecture.pdf', 'mechanical.pdf']);
  assert.deepEqual(new Map([...sources.keys()].map(path => [path, hash(path)])), initialHashes);

  const task = pdfjs.getDocument({ data: published.slice(), isEvalSupported: false, verbosity: 0 });
  try {
    const document = await task.promise;
    assert.equal(document.numPages, 3);
    assert.deepEqual(await document.getPageLabels(), ['A-101', 'A-102', 'M-201']);
    const outline = await document.getOutline();
    assert.deepEqual(outline.map(item => item.title), ['A-101', 'A-102 — Upper floor', 'M-201 — Ventilation']);
    assert.deepEqual(await Promise.all(outline.map(item => document.getPageIndex(item.dest[0]))), [0, 1, 2]);
    assert.deepEqual((await document.getPage(2)).view, [0, 0, 502, 702]);
  } finally {
    await task.destroy();
  }
});
