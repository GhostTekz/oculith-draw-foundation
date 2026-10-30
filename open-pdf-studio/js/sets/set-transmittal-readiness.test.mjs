import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { fingerprintPdfBytes } from './pdf-page-import.js';
import { buildSetTransmittalReadiness } from './set-transmittal-readiness.js';

async function pdf(pages) {
  const document = await PDFDocument.create();
  for (let page = 0; page < pages; page++) document.addPage([612, 792]).drawText(`Sheet ${page + 1}`);
  return new Uint8Array(await document.save());
}

test('transmittal review reads each exact PDF path once and reports independent current-source issues', async () => {
  const current = await pdf(2);
  const other = await pdf(1);
  const currentHash = await fingerprintPdfBytes(current);
  const otherHash = await fingerprintPdfBytes(other);
  const sheets = [
    { id: 'one', label: 'A-101', title: 'First', filePath: 'Set.pdf', page: 1, sourceSha256: currentHash },
    { id: 'two', label: 'A-102', title: 'Second', filePath: 'Set.pdf', page: 2, sourceSha256: currentHash },
    { id: 'unverified', label: 'A-103', title: '', filePath: 'Set.pdf', page: 1 },
    { id: 'changed', label: 'A-104', title: '', filePath: 'Set.pdf', page: 3, sourceSha256: otherHash },
    { id: 'missing', label: 'A-105', title: '', filePath: 'Missing.pdf', page: 1, sourceSha256: currentHash },
    { id: 'unreadable', label: 'A-106', title: '', filePath: 'Unreadable.pdf', page: 1, sourceSha256: currentHash },
    { id: 'case', label: 'A-107', title: '', filePath: 'set.pdf', page: 1, sourceSha256: otherHash },
  ].map(sheet => ({ revision: '', history: [], ...sheet }));
  const register = { version: 1, name: 'Issue set', sheets };
  const original = structuredClone(register);
  const files = new Map([['Set.pdf', current], ['set.pdf', other], ['Unreadable.pdf', new Uint8Array([1, 2, 3])]]);
  const reads = [];
  const result = await buildSetTransmittalReadiness(register, path => {
    reads.push(path);
    if (!files.has(path)) throw new Error('missing file');
    return files.get(path);
  });
  assert.equal(result.register, register);
  assert.equal(result.readyCount, 3);
  assert.deepEqual(reads.sort(), ['Missing.pdf', 'Set.pdf', 'Unreadable.pdf', 'set.pdf']);
  assert.deepEqual(result.rows.map(row => [row.label, row.issues]), [
    ['A-101', []], ['A-102', []], ['A-103', ['unverified']],
    ['A-104', ['changed', 'invalid-page']], ['A-105', ['missing']],
    ['A-106', ['unreadable']], ['A-107', []],
  ]);
  assert.equal(result.rows[0].pageCount, 2);
  assert.equal(result.rows[3].observedSha256, currentHash);
  assert.equal(result.rows[3].recordedSha256, otherHash);
  assert.deepEqual(register, original, 'a review never edits the register');
});

test('an empty register has no sources to read', async () => {
  const register = { version: 1, name: 'Empty', sheets: [] };
  const result = await buildSetTransmittalReadiness(register, () => { throw new Error('unexpected read'); });
  assert.deepEqual(result.rows, []);
  assert.equal(result.readyCount, 0);
});
