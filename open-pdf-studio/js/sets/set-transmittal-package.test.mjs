import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import { unzip } from '../bcf/bcf-zip.js';
import { buildSetPackage, createSetPackagePlan, recheckSetPackageSources, SET_PACKAGE_LIMITS } from './set-transmittal-package.js';
import { buildSetTransmittalReadiness } from './set-transmittal-readiness.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function pdf(labels) {
  const document = await PDFDocument.create();
  for (const label of labels) document.addPage([612, 792]).drawText(label);
  return new Uint8Array(await document.save());
}

function sheet(id, label, path, page, hash) {
  return { id, label, title: `${label} title`, revision: 'B',
    filePath: path, page, sourceSha256: hash, history: [], sourceAliases: [] };
}

test('package contains only selected pages, a portable manifest, and exact source evidence', async () => {
  const first = await pdf(['A-101', 'A-102']);
  const second = await pdf(['M-201']);
  const firstPath = '/private/project/plan.pdf';
  const secondPath = 'C:\\different\\plan.pdf';
  const register = { version: 1, name: 'Issue set', sheets: [
    sheet('m201', 'M-201', secondPath, 1, sha(second)),
    sheet('a102', 'A-102', firstPath, 2, sha(first)),
    sheet('a101', 'A-101', firstPath, 1, sha(first)),
  ] };
  const original = structuredClone(register);
  const files = new Map([[firstPath, first], [secondPath, second]]);
  const reads = [];
  const read = path => { reads.push(path); return files.get(path); };
  const readiness = await buildSetTransmittalReadiness(register, read);
  const plan = createSetPackagePlan(register, readiness, ['m201', 'a101'], {
    date: '2026-10-30', reference: 'IFC-07', note: 'Issued for construction\r\nPlease review',
  });
  assert.deepEqual(plan.sheets.map(row => row.label), ['A-101', 'M-201']);
  assert.equal(plan.sources.length, 2);
  reads.length = 0;
  const built = await buildSetPackage(plan, read);
  assert.deepEqual(reads, [firstPath, secondPath]);
  assert.deepEqual(built.manifest.sheets.map(row => [row.label, row.sourcePage, row.packagePage]),
    [['A-101', 1, 1], ['M-201', 1, 2]]);
  assert.deepEqual(built.manifest.issue, {
    date: '2026-10-30', reference: 'IFC-07', note: 'Issued for construction\nPlease review',
  });
  assert.deepEqual(built.manifest.sources.map(row => [row.fileName, row.sha256]),
    [['plan.pdf', sha(first)], ['plan.pdf', sha(second)]]);
  assert.doesNotMatch(JSON.stringify(built.manifest), /private\/project|C:\\different/u);
  const entries = await unzip(built.bytes);
  assert.deepEqual([...entries.keys()], ['manifest.json', 'current-sheets.pdf']);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))), built.manifest);
  assert.equal(sha(entries.get('current-sheets.pdf')), built.manifest.packagePdf.sha256);
  const task = pdfjs.getDocument({ data: entries.get('current-sheets.pdf').slice(),
    isEvalSupported: false, verbosity: 0 });
  try {
    const document = await task.promise;
    assert.equal(document.numPages, 2);
    assert.deepEqual(await document.getPageLabels(), ['A-101', 'M-201']);
  } finally { await task.destroy(); }
  reads.length = 0;
  await recheckSetPackageSources(plan, read);
  assert.deepEqual(reads, [firstPath, secondPath]);
  assert.deepEqual(register, original);
  assert.deepEqual(files.get(firstPath), first);
});

test('selection refuses unverified, missing, duplicate and over-limit sheets', async () => {
  const bytes = await pdf(['A-101']);
  const hash = sha(bytes);
  const register = { version: 1, name: 'Review', sheets: [
    sheet('ready', 'A-101', 'ready.pdf', 1, hash),
    { ...sheet('unverified', 'A-102', 'legacy.pdf', 1, hash), sourceSha256: undefined },
    sheet('missing', 'A-103', 'missing.pdf', 1, hash),
  ] };
  const review = await buildSetTransmittalReadiness(register, path => path === 'missing.pdf' ? null : bytes);
  assert.throws(() => createSetPackagePlan(register, review, ['unverified']), /readiness changed/u);
  assert.throws(() => createSetPackagePlan(register, review, ['missing']), /readiness changed/u);
  assert.throws(() => createSetPackagePlan(register, review, ['ready', 'ready']), /distinct current sheets/u);
  assert.throws(() => createSetPackagePlan(register, review, ['unknown']), /no longer in this drawing set/u);
  assert.throws(() => createSetPackagePlan(register, { ...review, register: {} }, ['ready']), /Check current sheet readiness/u);
  assert.throws(() => createSetPackagePlan(register, review,
    Array.from({ length: SET_PACKAGE_LIMITS.sheets + 1 }, (_, index) => String(index))), /Choose 1 to/u);
  const oversized = { ...review, rows: review.rows.map(row => row.sheetId === 'ready'
    ? { ...row, byteLength: SET_PACKAGE_LIMITS.sourceBytes + 1 } : row) };
  assert.throws(() => createSetPackagePlan(register, oversized, ['ready']), /128 MiB/u);
});

test('issue details validate dates and bounded plain text without changing the register', async () => {
  const bytes = await pdf(['A-101']);
  const register = { version: 1, name: 'Review', sheets: [sheet('ready', 'A-101', 'ready.pdf', 1, sha(bytes))] };
  const original = structuredClone(register);
  const review = await buildSetTransmittalReadiness(register, () => bytes);
  assert.deepEqual(createSetPackagePlan(register, review, ['ready']).issue,
    { date: '', reference: '', note: '' });
  assert.throws(() => createSetPackagePlan(register, review, ['ready'], { date: '2026-02-30' }), /valid issue date/u);
  assert.throws(() => createSetPackagePlan(register, review, ['ready'], { reference: 'R\n2' }), /one line/u);
  assert.throws(() => createSetPackagePlan(register, review, ['ready'], { reference: 'R'.repeat(81) }), /80 characters/u);
  assert.throws(() => createSetPackagePlan(register, review, ['ready'], { note: 'x'.repeat(501) }), /500 characters/u);
  assert.throws(() => createSetPackagePlan(register, review, ['ready'], { note: 'x\u0000y' }), /plain text/u);
  assert.deepEqual(register, original);
});

test('preview and final recheck reject changed bytes and a changed register', async () => {
  const original = await pdf(['A-101']);
  const changed = await pdf(['Changed A-101']);
  const register = { version: 1, name: 'Review', sheets: [sheet('ready', 'A-101', 'ready.pdf', 1, sha(original))] };
  const readiness = await buildSetTransmittalReadiness(register, () => original);
  const plan = createSetPackagePlan(register, readiness, ['ready']);
  await assert.rejects(buildSetPackage(plan, () => changed), /changed at/u);
  await buildSetPackage(plan, () => original);
  await assert.rejects(recheckSetPackageSources(plan, () => changed), /changed or became unavailable/u);
  await assert.rejects(recheckSetPackageSources(plan, () => null), /changed or became unavailable/u);
  register.sheets[0].title = 'Mutated title';
  await assert.rejects(recheckSetPackageSources(plan, () => original), /drawing set changed/u);
});

test('signed sources still fail the selected-page PDF safety check', async () => {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  const signedField = document.context.obj({ FT: 'Sig', T: 'Approval', V: { Type: 'Sig', ByteRange: [0, 1, 2, 3] } });
  document.catalog.set(PDFName.of('AcroForm'), document.context.obj({ Fields: [signedField] }));
  const bytes = new Uint8Array(await document.save());
  const register = { version: 1, name: 'Review', sheets: [sheet('signed', 'A-101', 'signed.pdf', 1, sha(bytes))] };
  const review = await buildSetTransmittalReadiness(register, () => bytes);
  const plan = createSetPackagePlan(register, review, ['signed']);
  await assert.rejects(buildSetPackage(plan, () => bytes), /signed or certified PDFs cannot be combined/u);
});
