import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createSheetRegister, addSheet, replaceSheet } from './sheet-register.js';
import { fingerprintPdfBytes } from './pdf-page-import.js';
import { buildSetRevisionSummary } from './set-revision-summary.js';

async function pdf(texts) {
  const document = await PDFDocument.create();
  for (const text of texts) document.addPage([612, 792]).drawText(text);
  return new Uint8Array(await document.save());
}

test('set summary inspects saved PDFs once per path and preserves registered pages and hashes', async () => {
  const old = await pdf(['Old cover', 'A-101 previous']);
  const current = await pdf(['New cover', 'Another sheet', 'A-101 current']);
  const oldHash = await fingerprintPdfBytes(old);
  const currentHash = await fingerprintPdfBytes(current);
  let register = createSheetRegister();
  const first = addSheet(register, { filePath: 'old.pdf', page: 2, label: 'A-101', revision: 'A', sourceSha256: oldHash });
  register = replaceSheet(first.register, first.sheet.id, 'current.pdf', 'B', '2026-10-30T00:00:00Z', 3, currentHash);
  register = addSheet(register, { filePath: 'current.pdf', page: 2, label: 'A-102', revision: 'B', sourceSha256: currentHash }).register;
  const files = new Map([['old.pdf', old], ['current.pdf', current]]);
  const reads = [];
  const read = async path => { reads.push(path); return files.get(path); };
  const result = await buildSetRevisionSummary(register, read);
  assert.equal(result.register, register);
  assert.deepEqual(reads.sort(), ['current.pdf', 'old.pdf']);
  assert.deepEqual(result.sheets.map(row => [row.label, row.status]), [['A-101', 'ready'], ['A-102', 'no-prior']]);
  assert.deepEqual([result.sheets[0].prior.page, result.sheets[0].current.page], [2, 3]);
  assert.deepEqual([result.sheets[0].prior.observedSha256, result.sheets[0].current.observedSha256], [oldHash, currentHash]);
  assert.deepEqual(register.sheets[0].history.map(source => source.filePath), ['old.pdf']);

  files.set('old.pdf', await pdf(['Changed cover', 'Changed A-101']));
  const changed = await buildSetRevisionSummary(register, read);
  assert.equal(changed.sheets[0].status, 'blocked');
  assert.equal(changed.sheets[0].prior.state, 'changed');
  assert.notEqual(changed.sheets[0].prior.observedSha256, oldHash);
  files.delete('old.pdf');
  const missing = await buildSetRevisionSummary(register, read);
  assert.equal(missing.sheets[0].prior.state, 'missing');
  assert.equal(missing.sheets[0].status, 'blocked');
  assert.deepEqual(register.sheets, result.register.sheets);
});

test('set summary blocks unrecorded, invalid page, unreadable and identical-path pairs', async () => {
  const old = await pdf(['Prior']);
  const current = await pdf(['Current']);
  const first = addSheet(createSheetRegister(), { filePath: 'old.pdf', page: 1, label: 'A-101', revision: 'A',
    sourceSha256: await fingerprintPdfBytes(old) });
  const register = replaceSheet(first.register, first.sheet.id, 'current.pdf', 'B', undefined, 1,
    await fingerprintPdfBytes(current));
  const files = new Map([['old.pdf', old], ['current.pdf', current]]);
  const read = path => files.get(path);
  const summary = value => buildSetRevisionSummary({ ...register, sheets: [{ ...register.sheets[0], ...value }] }, read);
  assert.equal((await summary({ sourceSha256: undefined })).sheets[0].current.state, 'unrecorded');
  assert.equal((await summary({ page: 2 })).sheets[0].current.state, 'invalid-page');
  assert.equal((await summary({ filePath: 'old.pdf' })).sheets[0].status, 'same-path');
  files.set('current.pdf', new Uint8Array([1, 2, 3]));
  assert.equal((await buildSetRevisionSummary(register, read)).sheets[0].current.state, 'unreadable');
});
